import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type PdfReplyExportPlugin from './main';

export class PdfReplyExportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: PdfReplyExportPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI).flatMap((item) => 'type' in item && item.type === 'group' ? item.items ?? [] : [item]) : [];
	}
}
