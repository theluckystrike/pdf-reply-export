import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PdfReplyExportPlugin from '../src/main';
import { bindPro, isPro, onProChange, resetPro, SPONSORS, PRO_UI } from '../src/pro';
import { groupComments, renderReview, type ReviewComment } from '../src/logic';
import { readComments, type PdfLibrary } from '../src/pdf';
import manifest from '../manifest.json';

const comments: ReviewComment[] = [{ id: 'a', parent: '', author: 'Alice', date: '', text: 'Parent review', page: 1 }, { id: 'b', parent: 'a', author: 'Bob', date: '', text: 'Reply', page: 1 }];
afterEach(() => resetPro());
function manager(pro = true) { return { isPro: () => pro, onChange: () => () => undefined }; }
function plugin() {
	const app = App.createConfigured__({ files: { 'Review.md': 'Keep this note', 'source.pdf': 'fixture' } });
	const p = new PdfReplyExportPlugin(app as never, manifest as never);
	return { p, app, source: { file: app.vault.getFileByPath('source.pdf')!, comments } };
}
describe('new review notes', () => {
	it('writes Review (2).md and keeps the existing note', async () => {
		const { p, app, source } = plugin();
		const file = await p.writeReview(source as never, 'Review');
		expect(file?.path).toBe('Review (2).md');
		expect(await app.vault.read(app.vault.getFileByPath('Review.md')!)).toBe('Keep this note');
		expect(await app.vault.read(file!)).toContain('Parent review');
	});
	it('does not write a note for an empty PDF', async () => {
		const { p, app, source } = plugin();
		expect(await p.writeReview({ ...source, comments: [] } as never, 'Empty')).toBeNull();
		expect(app.vault.getFileByPath('Empty.md')).toBeNull();
	});
	it('blocks folder export while Pro is off', async () => {
		const { p, app, source } = plugin();
		expect(await p.exportSources([source] as never, 'Batch', { author: '', from: '', to: '' }, true)).toEqual([]);
		expect(app.vault.getFileByPath('source review.md')).toBeNull();
	});
	it('free export ignores filter values; Pro export applies author filter', () => {
		const { p } = plugin();
		const filters = { author: 'Bob', from: '', to: '' };
		expect(p.rows(comments, filters)).toHaveLength(2);
		bindPro(manager() as never);
		expect(p.rows(comments, filters)).toMatchObject([{ id: 'b', group: 'Missing parents' }]);
	});
	it('Pro folder export writes one new note per nonempty PDF', async () => {
		const { p, app, source } = plugin();
		bindPro(manager() as never);
		const files = await p.exportSources([source] as never, '', { author: '', from: '', to: '' }, true);
		expect(files.map((f) => f.path)).toEqual(['source review.md']);
		expect(await app.vault.read(files[0]!)).toContain('Page 1');
	});
	it('a write failure is reported without a rejected batch promise', async () => {
		const { p, app, source } = plugin();
		app.vault.create = vi.fn(async () => { throw new Error('disk full'); });
		expect(await p.exportSources([source] as never, 'New', { author: '', from: '', to: '' }, false)).toEqual([]);
	});
});
describe('PDF resource cleanup', () => {
	it('reads page records with the annotation intent and destroys its task', async () => {
		const destroy = vi.fn(async () => undefined);
		const getAnnotations = vi.fn(async () => [{ subtype: 'Text', id: 'a', contentsObj: { str: 'Review' } }]);
		const getDocument = vi.fn(() => ({ promise: Promise.resolve({ numPages: 2, getPage: async () => ({ getAnnotations }) }), destroy }));
		const library: PdfLibrary = { getDocument };
		const result = await readComments({ readBinary: async () => new ArrayBuffer(1) }, {} as never, async () => library);
		expect(result.map((c) => c.page)).toEqual([1, 2]);
		expect(getAnnotations).toHaveBeenCalledWith({ intent: 'any' });
		expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ isEvalSupported: false, useWorkerFetch: false }));
		expect(destroy).toHaveBeenCalledOnce();
	});
	it('destroys the task after a page read fails', async () => {
		const destroy = vi.fn(async () => undefined);
		await expect(readComments({ readBinary: async () => new ArrayBuffer(1) }, {} as never, async () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => { throw new Error('page failed'); } }), destroy }) }))).rejects.toThrow('page failed');
		expect(destroy).toHaveBeenCalledOnce();
	});
});
describe('Sponsor facade', () => {
	it('uses the reference price and public client id', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0 });
		expect(PRO_UI.priceText).toContain('$5 a month, or $15 once');
	});
	it('binds changes and clears listeners on reset', () => {
		const listeners = new Set<() => void>();
		let state = false;
		bindPro({ isPro: () => state, onChange: (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); } } as never);
		const cb = vi.fn(); onProChange(cb);
		state = true; for (const l of listeners) l();
		expect(isPro()).toBe(true); expect(cb).toHaveBeenCalledOnce();
		resetPro(); expect(listeners.size).toBe(0); expect(isPro()).toBe(false);
	});
});
describe('text and malformed graphs', () => {
	it('renders unsafe comment strings as escaped text', () => {
		const md = renderReview('source.pdf', groupComments([{ ...comments[0]!, author: '<img>', text: '# Heading | <script>\n[[link]]' }]));
		expect(md).toContain('\\# Heading \\| &lt;script&gt;');
		expect(md).not.toContain('<script>');
		expect(md).toContain('Unknown date');
	});
	it('handles a deep chain without recursive traversal', () => {
		const chain = Array.from({ length: 5000 }, (_, i) => ({ ...comments[0]!, id: String(i), parent: i ? String(i - 1) : '' }));
		const rows = groupComments(chain);
		expect(rows).toHaveLength(5000); expect(rows[4999]?.depth).toBe(4999);
	});
});
