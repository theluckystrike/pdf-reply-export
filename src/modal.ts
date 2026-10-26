/* eslint obsidianmd/ui/sentence-case: ["warn", { "brands": ["Pro", "GitHub", "Obsidian"], "acronyms": ["PDF", "UTC"], "enforceCamelCaseLower": true }] -- Keep the Pro tier name and UTC acronym in UI text. */
import { Modal, Notice, Setting, normalizePath, type TFile } from 'obsidian';
import type PdfReplyExportPlugin from './main';
import { EMPTY_FILTERS, type Filters, type ReviewComment } from './logic';
import { isPro, onProChange, proNotice } from './pro';
export interface ReviewSource { file: TFile; comments: ReviewComment[] }

export class ReviewModal extends Modal {
	filters: Filters = { ...EMPTY_FILTERS };
	name = 'Review';
	private list!: HTMLElement;
	private status!: HTMLElement;
	private unbind: (() => void) | null = null;
	private running = false;
	constructor(public plugin: PdfReplyExportPlugin, public sources: ReviewSource[], public batch: boolean, public errors: string[]) { super(plugin.app); }
	onOpen(): void {
		this.setTitle(this.batch ? 'PDF folder review' : 'PDF review comments');
		this.modalEl.addClass('pdf-reply-export-modal');
		if (!this.batch) new Setting(this.contentEl).setName('New note name').addText((t) => t.setValue(this.name).onChange((s) => { this.name = s; }));
		const details = this.contentEl.createEl('details');
		details.open = isPro();
		details.createEl('summary', { text: 'Filters (Pro)' });
		const filters = details.createDiv({ cls: 'pdf-reply-export-filters' });
		new Setting(filters).setName('Author (Pro)').setDesc('Exact author name. Empty includes authors in the PDF.').addText((t) => t.onChange((s) => { this.filters.author = s; this.draw(); }));
		new Setting(filters).setName('Saved date from (Pro)').setDesc('UTC date, inclusive. Unknown dates stay in the output.').addText((t) => { t.inputEl.type = 'date'; t.onChange((s) => { this.filters.from = s; this.draw(); }); });
		new Setting(filters).setName('Saved date to (Pro)').addText((t) => { t.inputEl.type = 'date'; t.onChange((s) => { this.filters.to = s; this.draw(); }); });
		const update = () => { filters.querySelectorAll('input').forEach((input) => { input.disabled = !isPro(); }); this.draw(); };
		this.status = this.contentEl.createDiv({ cls: 'pdf-reply-export-status', attr: { role: 'status' } });
		this.list = this.contentEl.createDiv({ cls: 'pdf-reply-export-list' });
		new Setting(this.contentEl).addButton((b) => b.setButtonText(this.batch ? 'Write review notes' : 'Write review note').setCta().onClick(async () => {
			if (this.running) return;
			if (isPro() && this.filters.from && this.filters.to && this.filters.from > this.filters.to) { new Notice('The start date is after the end date.'); return; }
			this.running = true; b.setDisabled(true);
			try {
				const files = await this.plugin.exportSources(this.sources, this.name, this.filters, this.batch);
				if (files.length) { this.close(); await this.app.workspace.getLeaf(false).openFile(files[0]!); }
			} finally { this.running = false; b.setDisabled(false); }
		})).addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
		this.unbind = onProChange(update); update();
	}
	draw(): void {
		if (!this.list) return;
		this.list.empty();
		let count = 0;
		for (const source of this.sources) {
			const rows = this.plugin.rows(source.comments, this.filters);
			count += rows.length;
			this.list.createEl('h3', { text: source.file.path });
			if (!rows.length) this.list.createEl('p', { text: 'No comments' });
			let group = '';
			const lists: HTMLElement[] = [];
			for (const row of rows) {
				if (group !== row.group) {
					group = row.group;
					this.list.createEl('h4', { text: group });
					if (group === 'Cycles') this.list.createEl('p', { text: 'A parent cycle was found. These records appear once.' });
					lists.length = 0; lists.push(this.list.createEl('ul'));
				}
				const depth = Math.min(row.depth, 20);
				while (lists.length <= depth) {
					const parent = lists[lists.length - 1]!;
					const last = parent.lastElementChild ?? parent.createEl('li');
					lists.push(last.createEl('ul'));
				}
				lists.length = depth + 1;
				const item = lists[depth]!.createEl('li', { cls: 'pdf-reply-export-comment' });
				item.createEl('strong', { text: row.author });
				item.createSpan({ text: ` · ${row.date || 'Unknown date'} · `, cls: 'pdf-reply-export-meta' });
				const link = item.createEl('a', { text: `Page ${row.page}`, href: '#' });
				link.addEventListener('click', (event) => { event.preventDefault(); void this.app.workspace.getLeaf(false).openFile(source.file, { eState: { subpath: `#page=${row.page}` } }); });
				item.createDiv({ text: row.text || '(No comment text)', cls: 'pdf-reply-export-text' });
			}
		}
		this.status.setText(`${count} ${count === 1 ? 'comment' : 'comments'} · ${isPro() ? 'Pro is on' : 'Free version'}${this.errors.length ? '\n' + this.errors.join('\n') : ''}`);
	}
	onClose(): void { this.unbind?.(); this.unbind = null; this.contentEl.empty(); this.plugin.dialogs.delete(this); }
}
export class FolderModal extends Modal {
	constructor(public plugin: PdfReplyExportPlugin) { super(plugin.app); }
	onOpen(): void {
		this.setTitle('Select a PDF folder (Pro)');
		let folder = '';
		new Setting(this.contentEl).setName('Vault folder').setDesc('Vault relative path. Empty selects the vault root. Subfolders are included.').addText((t) => t.onChange((s) => { folder = s; }));
		new Setting(this.contentEl).addButton((b) => b.setButtonText('Preview folder').setCta().onClick(async () => {
			if (!isPro()) { proNotice('Folder export needs Pro.'); return; }
			const path = normalizePath(folder);
			if (path && !this.app.vault.getFolderByPath(path)) { new Notice('Folder not found.'); return; }
			const files = this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'pdf' && (!path || f.path.startsWith(path + '/'))).sort((a, c) => a.path.localeCompare(c.path));
			if (!files.length) { new Notice('No PDF files in this folder.'); return; }
			b.setDisabled(true);
			this.close();
			await this.plugin.previewFiles(files, true);
		})).addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
	}
	onClose(): void { this.contentEl.empty(); this.plugin.dialogs.delete(this); }
}
