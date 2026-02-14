import { App, Plugin, normalizePath, TFolder, Notice } from "obsidian";
import { createHash } from "crypto";
import VaultStateSettingTab from "./SettingTab";

interface FileState {
  path: string;
  name: string;
  mtime: number;
  size: number;
  hash?: string;
}

interface VaultSnapshot {
  createdAt: string;
  fileCount: number;
  files: FileState[];
}

interface VaultStateSettings {
  snapshotFolder: string;
  ignoredFolders: string; // comma-separated with wildcards
}

const DEFAULT_SETTINGS: VaultStateSettings = {
  snapshotFolder: "",
  ignoredFolders: ""
};

export default class VaultStatePlugin extends Plugin {
  settings: VaultStateSettings;
  private ignorePatterns: RegExp[] = [];

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new VaultStateSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      await this.saveSnapshotIfNeeded();
    });
  }

  // ===============================
  // Snapshot Controller
  // ===============================

  async saveSnapshotIfNeeded() {
    const today = this.getToday();
    const folder = this.settings.snapshotFolder;

    if (!folder || folder.length < 2) {
      new Notice("Invalid folder path.");
      return;
    }

    const fileName = `snapshot-${today}.json`;
    const fullPath = normalizePath(`${folder}/${fileName}`);

    const existing = this.app.vault.getAbstractFileByPath(fullPath);
    if (existing) return;

    await this.saveSnapshot(fullPath);
  }

  async saveSnapshot(fullPath: string) {
    const TEXT_EXTENSIONS = [
      "md", "txt", "csv", "json", "js", "ts",
      "css", "html", "yaml", "yml"
    ];

    const vault = this.app.vault;
    const files = vault.getFiles();

    const snapshot: VaultSnapshot = {
      createdAt: new Date().toISOString(),
      fileCount: 0,
      files: []
    };

    for (const file of files) {
      if (this.isIgnored(file.path)) continue;

      const isText = TEXT_EXTENSIONS.includes(file.extension);
      let hash: string | undefined = undefined;

      if (isText) {
        try {
          const content = await vault.read(file);
          hash = this.hashContent(content);
        } catch {
          console.warn("Falha ao ler arquivo:", file.path);
        }
      }

      const fileState: FileState = {
        path: file.path,
        name: file.name,
        mtime: file.stat.mtime,
        size: file.stat.size
      };

      if (hash) fileState.hash = hash;

      snapshot.files.push(fileState);
      snapshot.fileCount++;
    }

    await this.ensureFolder(this.settings.snapshotFolder);
    await vault.create(fullPath, JSON.stringify(snapshot));

    new Notice(
      `Snapshot created.\nTotal files: ${snapshot.fileCount}`,
      5000
    );
  }

  // ===============================
  // Ignore Logic
  // ===============================

  compileIgnorePatterns() {
    const patterns: RegExp[] = [];

    // 🔒 Sempre ignorar pasta de snapshots
    if (this.settings.snapshotFolder) {
      const escaped = this.settings.snapshotFolder
        .replace(/[.+^${}()|[\]\\]/g, "\\$&");
      patterns.push(new RegExp(`^${escaped}`));
    }

    // 👤 Padrões definidos pelo usuário
    if (this.settings.ignoredFolders) {
      const userPatterns = this.settings.ignoredFolders
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(pattern => {
          const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*");
          return new RegExp(`^${escaped}`);
        });

      patterns.push(...userPatterns);
    }

    this.ignorePatterns = patterns;
  }

  isIgnored(path: string): boolean {
    return this.ignorePatterns.some(regex => regex.test(path));
  }

  // ===============================
  // Utils
  // ===============================

  async ensureFolder(path: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;

    try {
      await this.app.vault.createFolder(path);
    } catch {
      // evita erro se já existir
    }
  }

  getToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  normalizeContent(content: string): string {
    return content
      .replace(/\r\n/g, "\n")
      .replace(/\uFEFF/g, "")
      .normalize("NFC")
      .trimEnd();
  }

  hashContent(content: string): string {
    const normalized = this.normalizeContent(content);
    return createHash("sha1").update(normalized).digest("hex");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.compileIgnorePatterns();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.compileIgnorePatterns();
  }
}
