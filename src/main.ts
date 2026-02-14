import { App, Plugin, normalizePath, TFolder, Notice, TFile } from "obsidian";
import { createHash } from "crypto";
import VaultStateSettingTab from "./SettingTab";

interface FileState {
  path: string;
  mtime: number;
  size: number;
  hash?: string;
}

interface BaseSnapshot {
  createdAt: string;
  files: Record<string, FileState>;
}

interface DeltaSnapshot {
  createdAt: string;
  added: FileState[];
  modified: FileState[];
  removed: string[];
}

interface VaultStateSettings {
  snapshotFolder: string;
  ignoredFolders: string;
}

const DEFAULT_SETTINGS: VaultStateSettings = {
  snapshotFolder: "",
  ignoredFolders: ""
};

const CONSOLIDATION_THRESHOLD = 30;

export default class VaultStatePlugin extends Plugin {
  settings: VaultStateSettings;
  private ignorePatterns: RegExp[] = [];

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new VaultStateSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      await this.runDeltaIfNeeded();
    });
  }

  // ======================================================
  // CONTROLLER
  // ======================================================

  async runDeltaIfNeeded() {
    const today = this.getToday();
    const folder = this.settings.snapshotFolder;
    if (!folder) return;

    await this.ensureFolder(folder);

    const deltaPath = normalizePath(`${folder}/delta-${today}.json`);
    if (this.app.vault.getAbstractFileByPath(deltaPath)) return;

    const basePath = normalizePath(`${folder}/base.json`);
    const baseExists = this.app.vault.getAbstractFileByPath(basePath);

    if (!baseExists) {
      await this.createBase();
      new Notice("Base snapshot created.", 4000);
      return;
    }

    await this.createDelta(deltaPath);
    await this.maybeConsolidate();
  }

  // ======================================================
  // BASE CREATION
  // ======================================================

  async createBase() {
    const files = this.app.vault.getFiles();
    const base: BaseSnapshot = {
      createdAt: new Date().toISOString(),
      files: {}
    };

    for (const file of files) {
      if (this.isIgnored(file.path)) continue;
      base.files[file.path] = await this.buildFileState(file);
    }

    const path = normalizePath(`${this.settings.snapshotFolder}/base.json`);
    await this.app.vault.modify(
      this.app.vault.getAbstractFileByPath(path) as TFile ?? 
      await this.app.vault.create(path, ""),
      JSON.stringify(base)
    );
  }

  // ======================================================
  // DELTA CREATION
  // ======================================================

  async createDelta(deltaPath: string) {
    const previousState = await this.rebuildCurrentState();
    const currentFiles = this.app.vault.getFiles();

    const currentMap = new Map<string, TFile>();
    currentFiles.forEach(f => {
      if (!this.isIgnored(f.path)) currentMap.set(f.path, f);
    });

    const added: FileState[] = [];
    const modified: FileState[] = [];
    const removed: string[] = [];

    for (const path in previousState) {
      if (!currentMap.has(path)) removed.push(path);
    }

    for (const file of currentMap.values()) {
      const prev = previousState[file.path];
      if (!prev) {
        added.push(await this.buildFileState(file));
      } else if (prev.mtime !== file.stat.mtime) {
        modified.push(await this.buildFileState(file));
      }
    }

    if (!added.length && !modified.length && !removed.length) return;

    const delta: DeltaSnapshot = {
      createdAt: new Date().toISOString(),
      added,
      modified,
      removed
    };

    await this.app.vault.create(deltaPath, JSON.stringify(delta));

    new Notice(
      `Delta created  +${added.length}  ~${modified.length}  -${removed.length}`,
      4000
    );
  }

  // ======================================================
  // CONSOLIDATION
  // ======================================================

  async maybeConsolidate() {
    const folder = this.settings.snapshotFolder;

    const deltas = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(folder) && f.name.startsWith("delta-"));

    if (deltas.length < CONSOLIDATION_THRESHOLD) return;

    const rebuilt = await this.rebuildCurrentState();

    const newBase: BaseSnapshot = {
      createdAt: new Date().toISOString(),
      files: rebuilt
    };

    const basePath = normalizePath(`${folder}/base.json`);

    const baseFile = this.app.vault.getAbstractFileByPath(basePath) as TFile;

    if (baseFile) {
      await this.app.vault.modify(baseFile, JSON.stringify(newBase));
    } else {
      await this.app.vault.create(basePath, JSON.stringify(newBase));
    }

    for (const delta of deltas) {
      await this.app.vault.delete(delta);
    }

    new Notice("Snapshots consolidated into new base.", 5000);
  }

  // ======================================================
  // STATE REBUILD
  // ======================================================

  async rebuildCurrentState(): Promise<Record<string, FileState>> {
    const folder = this.settings.snapshotFolder;
    const baseFile = this.app.vault.getAbstractFileByPath(
      normalizePath(`${folder}/base.json`)
    ) as TFile;

    const baseContent = await this.app.vault.read(baseFile);
    const base: BaseSnapshot = JSON.parse(baseContent);

    const state: Record<string, FileState> = { ...base.files };

    const deltas = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(folder) && f.name.startsWith("delta-"))
      .sort((a, b) => a.stat.mtime - b.stat.mtime);

    for (const deltaFile of deltas) {
      const content = await this.app.vault.read(deltaFile);
      const delta: DeltaSnapshot = JSON.parse(content);

      for (const a of delta.added) state[a.path] = a;
      for (const m of delta.modified) state[m.path] = m;
      for (const r of delta.removed) delete state[r];
    }

    return state;
  }

  // ======================================================
  // FILE STATE
  // ======================================================

  async buildFileState(file: TFile): Promise<FileState> {
    const TEXT_EXTENSIONS = [
      "md","txt","csv","json","js","ts",
      "css","html","yaml","yml"
    ];

    let hash: string | undefined;

    if (TEXT_EXTENSIONS.includes(file.extension)) {
      try {
        const content = await this.app.vault.read(file);
        hash = this.hashContent(content);
      } catch {}
    }

    return {
      path: file.path,
      mtime: file.stat.mtime,
      size: file.stat.size,
      ...(hash ? { hash } : {})
    };
  }

  // ======================================================
  // IGNORE
  // ======================================================

  compileIgnorePatterns() {
    const patterns: RegExp[] = [];

    if (this.settings.snapshotFolder) {
      const escaped = this.settings.snapshotFolder
        .replace(/[.+^${}()|[\]\\]/g, "\\$&");
      patterns.push(new RegExp(`^${escaped}`));
    }

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

  // ======================================================
  // UTILS
  // ======================================================

  async ensureFolder(path: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    try { await this.app.vault.createFolder(path); } catch {}
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
    return createHash("sha1").update(content).digest("hex");
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
