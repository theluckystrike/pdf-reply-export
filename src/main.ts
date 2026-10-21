/* eslint obsidianmd/ui/sentence-case: ["warn", { "brands": ["Pro", "GitHub", "Obsidian"], "acronyms": ["PDF", "UTC"], "enforceCamelCaseLower": true }] -- Keep the Pro tier name and UTC acronym in UI text. */
import { Notice, Plugin, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { PdfReplyExportSettingTab } from './settings';
import { ReviewModal, FolderModal, type ReviewSource } from './modal';
import { EMPTY_FILTERS, filterComments, groupComments, newPath, renderReview, type Filters, type ReviewComment } from './logic';
import { readComments } from './pdf';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class PdfReplyExportPlugin extends Plugin {
	pro: SponsorsManager | null = null;
	readonly dialogs = new Set<ReviewModal | FolderModal>();
	private reading = false;
	private writing = false;
	private disposed = false;
	private reader: AbortController | null = null;
	onload(): void {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new PdfReplyExportSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.app.workspace.onLayoutReady(() => {
			if (this.disposed) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
		this.addCommand({ id: 'preview-active-pdf', name: 'Preview comments from the active PDF', checkCallback: (checking) => {
			const file = this.app.workspace.getActiveFile();
			if (!file || file.extension.toLowerCase() !== 'pdf') return false;
			if (!checking) void this.previewFiles([file]);
			return true;
		} });
		this.addCommand({ id: 'preview-pdf-folder', name: 'Export a PDF folder (Pro)', callback: () => {
			if (!isPro()) { new Notice('Folder export needs Pro. Open the plugin settings to sign in with GitHub.'); return; }
			const dialog = new FolderModal(this); this.dialogs.add(dialog); dialog.open();
		} });
	}
	onunload(): void {
		this.disposed = true;
		this.reader?.abort();
		for (const dialog of this.dialogs) dialog.close();
		resetPro();
	}
	async previewFiles(files: TFile[], batch = false): Promise<ReviewModal | null> {
		if (this.reading || this.disposed || (batch && !isPro())) return null;
		this.reading = true;
		const reader = new AbortController();
		this.reader = reader;
		const sources: ReviewSource[] = [], errors: string[] = [];
		try {
			for (const file of files) {
				if (this.disposed) break;
				try {
					const comments = await readComments(this.app.vault, file, undefined, reader.signal);
					sources.push({ file, comments });
				} catch (e) { errors.push(`${file.path}: ${e instanceof Error ? e.message : String(e)}`); }
			}
			if (this.disposed) return null;
			if (!sources.some((s) => groupComments(s.comments).length)) {
				new Notice(errors.length ? `Could not read comments. ${errors.join('\n')}` : 'No comments'); return null;
			}
			const dialog = new ReviewModal(this, sources, batch, errors);
			this.dialogs.add(dialog); dialog.open(); return dialog;
		} finally { this.reading = false; this.reader = null; }
	}
	rows(comments: ReviewComment[], filters: Filters = EMPTY_FILTERS) {
		return groupComments(filterComments(comments, filters, isPro()));
	}
	async writeReview(source: ReviewSource, name: string, filters: Filters = EMPTY_FILTERS): Promise<TFile | null> {
		const rows = this.rows(source.comments, filters);
		if (!rows.length || this.disposed) return null;
		// Vault.create refuses an existing path. Recheck a collision caused by another writer.
		for (let attempt = 0; attempt < 10; attempt++) {
			const path = normalizePath(newPath(source.file.parent?.path ?? '', name, (p) => !!this.app.vault.getAbstractFileByPath(normalizePath(p))));
			try { return await this.app.vault.create(path, renderReview(source.file.path, rows)); }
			catch (e) { if (!this.app.vault.getAbstractFileByPath(path)) throw e; }
		}
		throw new Error('Could not find a free note name.');
	}
	async exportSources(sources: ReviewSource[], name: string, filters: Filters, batch: boolean): Promise<TFile[]> {
		if (this.writing || this.disposed) return [];
		if (batch && !isPro()) { new Notice('Folder export needs Pro.'); return []; }
		this.writing = true;
		const written: TFile[] = [], errors: string[] = [];
		try {
			for (const source of sources) {
				if (batch && !isPro()) { errors.push('Pro is off. Folder export stopped.'); break; }
				try {
					const file = await this.writeReview(source, batch ? `${source.file.basename} review` : name, filters);
					if (file) written.push(file);
				} catch (e) { errors.push(`${source.file.path}: ${e instanceof Error ? e.message : String(e)}`); }
			}
			new Notice(`${written.length} review notes written.${errors.length ? '\n' + errors.join('\n') : ''}`);
			return written;
		} finally { this.writing = false; }
	}
}
