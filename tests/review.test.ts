import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { parseLinktext } from 'obsidian';
import PdfReplyExportPlugin from '../src/main';
import { ReviewModal } from '../src/modal';
import { PdfReplyExportSettingTab } from '../src/settings';
import { groupComments, type ReviewComment } from '../src/logic';
import { readComments } from '../src/pdf';
import * as pdfModule from '../src/pdf';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

// The test mock omits the documented Unicode and space normalization.
vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return { ...actual, normalizePath: (path: string) => actual.normalizePath(path).replace(/[\u00a0\u202f]/g, ' ').normalize() };
});

function plugin() {
	const app = App.createConfigured__({ files: { 'Review one.md': 'Keep', 'Café.md': 'Keep', 'source.pdf': 'fixture' } });
	const p = new PdfReplyExportPlugin(app as never, manifest as never);
	const comment: ReviewComment = { id: 'a', parent: '', author: 'Alice', date: '', text: 'Review', page: 1 };
	return { p, app, source: { file: app.vault.getFileByPath('source.pdf')!, comments: [comment] } };
}
afterEach(() => { resetPro(); vi.restoreAllMocks(); });

describe('review regressions', () => {
	it('opens a new note by file identity when its folder contains a hash', async () => {
		const { p, app, source } = plugin();
		await app.vault.createFolder('Folder#1');
		const file = await app.vault.create('Folder#1/Review.md', 'Review');
		vi.spyOn(p, 'exportSources').mockResolvedValue([file] as never);
		const openFile = vi.fn(async () => undefined);
		vi.spyOn(app.workspace, 'getLeaf').mockReturnValue({ openFile } as never);
		// The workspace mock does not parse fragments. Use the public link parser here.
		vi.spyOn(app.workspace, 'openLinkText').mockImplementation(async (linktext) => {
			const target = app.vault.getFileByPath(parseLinktext(linktext).path);
			if (target) await openFile(target);
		});
		const dialog = new ReviewModal(p, [source] as never, false, []);
		dialog.onOpen();
		dialog.contentEl.querySelector('button')!.click();
		await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith(file));
		dialog.onClose();
	});
	it('sorts unknown dates after a valid date in the final four-digit year', () => {
		const { source } = plugin();
		const base = source.comments[0]!;
		const rows = groupComments([
			base,
			{ ...base, id: 'known', parent: 'a', date: '9999-12-31T00:00:00.000Z' },
			{ ...base, id: 'unknown', parent: 'a' },
		]);
		expect(rows.map((c) => c.id)).toEqual(['a', 'known', 'unknown']);
	});
	it('destroys an active PDF loading task on cancellation', async () => {
		const controller = new AbortController();
		let rejectLoad!: (error: Error) => void;
		const loading = new Promise<never>((_, reject) => { rejectLoad = reject; });
		const destroy = vi.fn(async () => { rejectLoad(new Error('PDF read cancelled.')); });
		const getDocument = vi.fn(() => ({ promise: loading, destroy }));
		const result = readComments({ readBinary: async () => new ArrayBuffer(1) }, {} as never, async () => ({ getDocument }), controller.signal);
		const rejected = expect(result).rejects.toThrow('PDF read cancelled.');
		await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
		controller.abort();
		try { expect(destroy).toHaveBeenCalledOnce(); }
		finally { rejectLoad(new Error('PDF read cancelled.')); await rejected; }
		expect(destroy).toHaveBeenCalledOnce();
	});
	it('stops reading the remaining PDFs after unload', async () => {
		const { p, source } = plugin();
		const read = vi.spyOn(pdfModule, 'readComments').mockImplementation(async () => {
			p.onunload();
			return source.comments;
		});
		expect(await p.previewFiles([source.file, source.file] as never)).toBeNull();
		expect(read).toHaveBeenCalledOnce();
	});
	it('opens a PDF by file identity when its name contains a hash', () => {
		const { p, app, source } = plugin();
		source.file.path = 'C# guide.pdf';
		const openFile = vi.fn(async () => undefined);
		vi.spyOn(app.workspace, 'getLeaf').mockReturnValue({ openFile } as never);
		const dialog = new ReviewModal(p, [source] as never, false, []);
		dialog.onOpen();
		dialog.contentEl.querySelector('a')!.click();
		expect(openFile).toHaveBeenCalledWith(source.file, { eState: { subpath: '#page=1' } });
		dialog.onClose();
	});

	it.each(['Review\u00a0one', 'Cafe\u0301'])('checks collisions after path normalization for %s', async (name) => {
		const { p, app, source } = plugin();
		const file = await p.writeReview(source as never, name);
		expect(file?.path).toBe(name === 'Review\u00a0one' ? 'Review one (2).md' : 'Café (2).md');
		expect(await app.vault.read(app.vault.getFileByPath('Review one.md')!)).toBe('Keep');
		expect(await app.vault.read(app.vault.getFileByPath('Café.md')!)).toBe('Keep');
	});

	it('keeps a child below its cycle parent when the child has an earlier date', () => {
		const { source } = plugin();
		const base = source.comments[0]!;
		const rows = groupComments([
			{ ...base, id: 'a', parent: 'b', date: '2026-10-02T00:00:00.000Z' },
			{ ...base, id: 'b', parent: 'a', date: '2026-10-03T00:00:00.000Z' },
			{ ...base, id: 'child', parent: 'b', date: '2026-10-01T00:00:00.000Z' },
		]);
		expect(rows.map((c) => [c.id, c.depth, c.group])).toEqual([
			['a', 0, 'Cycles'], ['b', 1, 'Cycles'], ['child', 2, 'Cycles'],
		]);
	});

	it('reads a page with 150000 annotations without an argument limit error', async () => {
		const count = 150000;
		const annotations = Array.from({ length: count }, (_, i) => ({ subtype: 'Text', id: String(i), contents: 'Review' }));
		const destroy = vi.fn(async () => undefined);
		const result = await readComments({ readBinary: async () => new ArrayBuffer(1) }, {} as never, async () => ({
			getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getAnnotations: async () => annotations }) }), destroy }),
		}));
		expect(result).toHaveLength(count);
		expect(result[count - 1]?.id).toBe(String(count - 1));
		expect(destroy).toHaveBeenCalledOnce();
	});

	it('has no heading for the single settings section', () => {
		const { p, app } = plugin();
		p.onload();
		const tab = new PdfReplyExportSettingTab(app as never, p);
		const definitions = tab.productSettingDefinitions();
		expect(definitions).toHaveLength(2);
		expect(definitions.every((item) => !('heading' in item))).toBe(true);
		// The tab ends with the "More from NoteMods" group of packages/hello, the only heading.
		expect(tab.getSettingDefinitions().slice(2)).toEqual([expect.objectContaining({ type: 'group', heading: 'More from NoteMods' })]);
		p.unload();
	});

	it('does not start an interval after unload before layout ready', () => {
		const { p, app } = plugin();
		let ready: (() => void) | undefined;
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((cb) => { ready = cb; });
		const interval = vi.spyOn(window, 'setInterval');
		p.onload();
		p.onunload();
		ready?.();
		expect(interval).not.toHaveBeenCalled();
	});
});
