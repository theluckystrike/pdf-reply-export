import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId, reloadPlugin } from './load';

interface ReviewPlugin {
	pro: { signOut(): void; refreshNow(): Promise<unknown>; opts: { http: unknown } };
	dialogs: Set<{ close(): void }>;
	previewFiles(files: unknown[], batch?: boolean): Promise<unknown>;
}
async function prepare(pro = false): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, paid) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, ReviewPlugin> } }).plugins.plugins[id]!;
		for (const d of p.dialogs) d.close();
		p.pro.signOut();
		if (paid) {
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		}
	}, pluginId, pro);
}
async function preview(path: string): Promise<void> {
	await obsidianPage.openFile(path);
	await browser.executeObsidianCommand(`${pluginId}:preview-active-pdf`);
	await browser.waitUntil(async () => (await browser.$('.pdf-reply-export-list')).isExisting(), { timeout: 20000, timeoutMsg: 'No review preview' });
}
async function button(label: string): Promise<void> {
	const buttons = await browser.$$('.pdf-reply-export-modal button');
	for (const b of buttons) if (await b.getText() === label) { await b.click(); return; }
	throw new Error(`Missing button ${label}`);
}
async function pdfNotes(): Promise<string[]> {
	return browser.executeObsidian(({ app }) => app.vault.getMarkdownFiles().filter((f) => f.path.startsWith('probe/')).map((f) => f.path).sort());
}
describe(`${pluginId} in the real app`, function () {
	beforeEach(async function () { await prepare(); });
	afterEach(async function () { await prepare(); });
	it('loads and reloads without console errors', async function () {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('reads native parent and reply records; popup and Group do not duplicate replies', async function () {
		await preview('probe/review-links-fixture.pdf');
		const result = await browser.execute(() => {
			const list = document.querySelector('.pdf-reply-export-list')!;
			return { authors: Array.from(list.querySelectorAll('.pdf-reply-export-comment > strong')).map((e) => e.textContent), nested: list.querySelectorAll('ul ul ul > li').length, texts: Array.from(list.querySelectorAll('.pdf-reply-export-text')).map((e) => e.textContent), pages: Array.from(list.querySelectorAll('a')).map((e) => e.textContent) };
		});
		expect(result).toEqual({ authors: ['Alice', 'Bob', 'Cara'], nested: 1, texts: ['Parent review', 'First reply', 'Nested reply'], pages: ['Page 1', 'Page 1', 'Page 1'] });
	});
	it('Cancel and an empty PDF leave note paths unchanged', async function () {
		const before = await pdfNotes();
		await preview('probe/review-links-fixture.pdf');
		await button('Cancel');
		expect(await pdfNotes()).toEqual(before);
		await obsidianPage.openFile('probe/empty.pdf');
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, ReviewPlugin> } }).plugins.plugins[id]!;
			await p.previewFiles([app.vault.getFileByPath('probe/empty.pdf')!]);
		}, pluginId);
		await browser.waitUntil(async () => (await lastNotice()) === 'No comments', { timeout: 5000, timeoutMsg: 'No comments notice did not appear' });
		expect(await pdfNotes()).toEqual(before);
	});
	it('writes a new Markdown review and keeps an existing note', async function () {
		await obsidianPage.write('probe/Review.md', 'Keep this note');
		await preview('probe/review-links-fixture.pdf');
		await button('Write review note');
		await browser.waitUntil(async () => (await pdfNotes()).includes('probe/Review (2).md'), { timeout: 10000, timeoutMsg: 'New note was not created' });
		const text = await obsidianPage.read('probe/Review (2).md');
		expect(await obsidianPage.read('probe/Review.md')).toBe('Keep this note');
		expect(text).toContain('    - **Cara**');
		expect(text.match(/#page=1/g)?.length).toBe(4);
	});
	it('shows missing parents, cycles and unsafe strings as text', async function () {
		await preview('probe/edge-cases.pdf');
		const result = await browser.execute(() => {
			const list = document.querySelector('.pdf-reply-export-list')!;
			return { text: list.textContent, scripts: list.querySelectorAll('script').length, comments: list.querySelectorAll('.pdf-reply-export-comment').length };
		});
		expect(result.text).toContain('Missing parents');
		expect(result.text).toContain('Cycles');
		expect(result.text).toContain('Unknown date');
		expect(result.text).toContain('# Heading | <script>alert(1)</script>');
		expect(result.scripts).toBe(0);
		expect(result.comments).toBe(4);
	});
	it('free mode disables filters and blocks folder export', async function () {
		await preview('probe/review-links-fixture.pdf');
		const disabled = await browser.execute(() => Array.from(document.querySelectorAll<HTMLInputElement>('.pdf-reply-export-filters input')).map((e) => e.disabled));
		expect(disabled).toEqual([true, true, true]);
		await button('Cancel');
		await browser.executeObsidianCommand(`${pluginId}:preview-pdf-folder`);
		await browser.waitUntil(async () => (await lastNotice()).includes('Folder export needs'), { timeout: 5000, timeoutMsg: 'Pro notice did not appear' });
	});
	it('Pro filters by author and writes the filtered reply under Missing parents', async function () {
		await prepare(true);
		await preview('probe/review-links-fixture.pdf');
		const author = await browser.$('.pdf-reply-export-filters input');
		await author.setValue('Bob');
		await browser.waitUntil(async () => (await browser.execute(() => document.querySelectorAll('.pdf-reply-export-comment').length)) === 1, { timeout: 5000, timeoutMsg: 'Author filter did not change the preview' });
		expect(await (await browser.$('.pdf-reply-export-list')).getText()).toContain('Missing parents');
		await browser.execute(() => {
			const input = document.querySelector<HTMLInputElement>('.pdf-reply-export-modal input')!;
			input.value = 'Filtered'; input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await button('Write review note');
		await browser.waitUntil(async () => (await pdfNotes()).includes('probe/Filtered.md'), { timeout: 10000 });
		const text = await obsidianPage.read('probe/Filtered.md');
		expect(text).toContain('First reply');
		expect(text).not.toContain('Parent review');
	});
	it('Pro date inputs filter valid saved days and keep unknown dates', async function () {
		await prepare(true);
		await preview('probe/review-links-fixture.pdf');
		await browser.execute(() => {
			const inputs = document.querySelectorAll<HTMLInputElement>('.pdf-reply-export-filters input');
			inputs[1]!.value = '2026-10-02'; inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await browser.waitUntil(async () => (await browser.execute(() => document.querySelectorAll('.pdf-reply-export-comment').length)) === 0, { timeout: 5000 });
		expect(await (await browser.$('.pdf-reply-export-list')).getText()).toContain('No comments');
		const before = await pdfNotes();
		await button('Write review note');
		expect(await pdfNotes()).toEqual(before);
		await prepare(true);
		await preview('probe/edge-cases.pdf');
		await browser.execute(() => {
			const inputs = document.querySelectorAll<HTMLInputElement>('.pdf-reply-export-filters input');
			inputs[1]!.value = '2026-10-02'; inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
		});
		expect(await browser.execute(() => document.querySelectorAll('.pdf-reply-export-comment').length)).toBe(4);
	});
	it('a preview page link opens the local source PDF', async function () {
		await preview('probe/review-links-fixture.pdf');
		await obsidianPage.openFile('Welcome.md');
		await (await browser.$('.pdf-reply-export-list a')).click();
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)) === 'probe/review-links-fixture.pdf', { timeout: 10000, timeoutMsg: 'Source PDF did not open' });
	});
	it('Pro folder command previews and writes nonempty PDF reviews', async function () {
		await prepare(true);
		await browser.executeObsidianCommand(`${pluginId}:preview-pdf-folder`);
		await browser.waitUntil(async () => (await browser.$('.modal input')).isExisting(), { timeout: 5000 });
		await (await browser.$('.modal input')).setValue('probe');
		await browser.execute(() => Array.from(document.querySelectorAll<HTMLButtonElement>('.modal button')).find((b) => b.textContent === 'Preview folder')!.click());
		await browser.waitUntil(async () => (await browser.$('.pdf-reply-export-list')).isExisting(), { timeout: 20000 });
		expect(await (await browser.$('.pdf-reply-export-status')).getText()).toContain('7 comments');
		await button('Write review notes');
		await browser.waitUntil(async () => (await pdfNotes()).includes('probe/edge-cases review.md') && (await pdfNotes()).includes('probe/review-links-fixture review.md'), { timeout: 10000 });
		expect((await pdfNotes()).includes('probe/empty review.md')).toBe(false);
	});
	it('normalizes a note name before collision checks', async function () {
		await obsidianPage.write('probe/Review one.md', 'Keep normalized name');
		await preview('probe/review-links-fixture.pdf');
		await browser.execute(() => {
			const input = document.querySelector<HTMLInputElement>('.pdf-reply-export-modal input')!;
			input.value = 'Review\u00a0one'; input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await button('Write review note');
		await browser.waitUntil(async () => (await pdfNotes()).includes('probe/Review one (2).md'), { timeout: 10000 });
		expect(await obsidianPage.read('probe/Review one.md')).toBe('Keep normalized name');
	});

	it('opens the preview source when its PDF name contains a hash', async function () {
		await browser.executeObsidian(async ({ app }) => {
			const data = await app.vault.readBinary(app.vault.getFileByPath('probe/review-links-fixture.pdf')!);
			await app.vault.createBinary('probe/C# guide.pdf', data);
		});
		await preview('probe/C# guide.pdf');
		await obsidianPage.openFile('Welcome.md');
		await (await browser.$('.pdf-reply-export-list a')).click();
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)) === 'probe/C# guide.pdf', { timeout: 5000 });
	});

	it('opens the exported source without selecting a same-path file in a subfolder', async function () {
		await browser.executeObsidian(async ({ app }) => {
			const data = await app.vault.readBinary(app.vault.getFileByPath('probe/empty.pdf')!);
			await app.vault.createFolder('probe/probe');
			await app.vault.createBinary('probe/probe/review-links-fixture.pdf', data);
		});
		await preview('probe/review-links-fixture.pdf');
		await browser.execute(() => {
			const input = document.querySelector<HTMLInputElement>('.pdf-reply-export-modal input')!;
			input.value = 'Link check'; input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await button('Write review note');
		await browser.waitUntil(async () => (await pdfNotes()).includes('probe/Link check.md'), { timeout: 10000 });
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.getLeaf(false).setViewState({ type: 'markdown', state: { file: 'probe/Link check.md', mode: 'preview' } });
		});
		await browser.waitUntil(async () => (await browser.$('.markdown-preview-view a.internal-link')).isExisting(), { timeout: 5000 });
		await (await browser.$('.markdown-preview-view a.internal-link')).click();
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)) === 'probe/review-links-fixture.pdf', { timeout: 5000 });
	});
	it('opens the new note when its source folder contains a hash', async function () {
		await browser.executeObsidian(async ({ app }) => {
			const data = await app.vault.readBinary(app.vault.getFileByPath('probe/review-links-fixture.pdf')!);
			await app.vault.createFolder('probe/Hash# folder');
			await app.vault.createBinary('probe/Hash# folder/source.pdf', data);
		});
		await preview('probe/Hash# folder/source.pdf');
		await button('Write review note');
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)) === 'probe/Hash# folder/Review.md', { timeout: 5000 });
	});
});
