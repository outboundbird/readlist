import { App, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';

export interface MyPluginSettings {
	defaultFolder: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	defaultFolder: 'Papers',
};

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Default folder')
			.setDesc('Folder where new paper notes are saved by default.')
			.addText((text) =>
				text
					.setPlaceholder('Papers')
					.setValue(this.plugin.settings.defaultFolder)
					.onChange(async (value) => {
						this.plugin.settings.defaultFolder =
							value.trim() || 'Papers';
						await this.plugin.saveSettings();
					}),
			);
	}
}
