import { App, Plugin, TFile, normalizePath, TFolder } from "obsidian";
import { createHash } from "crypto";

interface FileState {
  path: string;
  name: string;
  mtime: number;
  size: number;
  hash: string;
}

interface VaultSnapshot {
  createdAt: string;
  fileCount: number;
  files: FileState[];
}

export default class VaultStatePlugin extends Plugin {

  async onload() {
    this.addCommand({
      id: "save-vault-state",
      name: "Save vault snapshot",
      callback: () => this.saveSnapshot()
    });

    this.registerEvent(
      this.app.workspace.on("quit", () => {
        this.saveSnapshot();
      })
    );
  }

  async saveSnapshot() {
    const TEXT_EXTENSIONS = [
      "md", "txt", "csv", "json", "js", "ts", "css", "html", "yaml", "yml"
    ];

    const vault = this.app.vault;
    const files = vault.getFiles();

    const snapshot: VaultSnapshot = {
      createdAt: new Date().toISOString(),
      fileCount: files.length,
      files: []
    };

    for (const file of files) {
      const isText = TEXT_EXTENSIONS.includes(file.extension);

      let hash = null;
      if (isText) {
        try {
          const content = await vault.read(file);
          hash = this.hashContent(content);
        } catch (err) {
          console.warn("⚠️ Falha ao ler arquivo texto:", file.path);
        }
      }

      snapshot.files.push({
        path: file.path,
        name: file.name,
        mtime: file.stat.mtime,
        size: file.stat.size,
        hash
      });
    }

    const folder = "00 Metadata/State/Vault Snapshots";
    const fileName = `snapshot-${snapshot.createdAt.slice(0, 19)}.json`;
    const fullPath = normalizePath(`${folder}/${fileName}`);

    await this.ensureFolder(folder);

    await vault.create(fullPath, JSON.stringify(snapshot, null, 2));
  }

  async ensureFolder(path: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFolder) return;

    try {
      await this.app.vault.createFolder(path);
    } catch (err) {
    }
  }

  hashContent(content: string): string {
    return createHash("sha1").update(content).digest("hex");
  }
}
