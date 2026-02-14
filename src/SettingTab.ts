import { App, PluginSettingTab, Setting } from "obsidian";
import VaultStatePlugin from "./main";

export default class VaultStateSettingTab extends PluginSettingTab {
  plugin: VaultStatePlugin;

  constructor(app: App, plugin: VaultStatePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Snapshot Folder")
      .setDesc("Folder where vault snapshots will be stored")
      .addText(text =>
        text
          .setPlaceholder("Folder path")
          .setValue(this.plugin.settings.snapshotFolder)
          .onChange(async (value) => {
            this.plugin.settings.snapshotFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
