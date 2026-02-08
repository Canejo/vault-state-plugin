import { App, Plugin, TFile, normalizePath } from "obsidian";
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
      name: "Salvar snapshot do vault",
      callback: () => this.saveSnapshot()
    });

    // snapshot automático ao fechar
    this.registerEvent(
      this.app.workspace.on("quit", () => {
        this.saveSnapshot();
      })
    );
  }

  async saveSnapshot() {
    const vault = this.app.vault;
    const files = vault.getFiles();

    const snapshot: VaultSnapshot = {
      createdAt: new Date().toISOString(),
      fileCount: files.length,
      files: []
    };

    for (const file of files) {
      const content = await vault.read(file);
      snapshot.files.push({
        path: file.path,
        name: file.name,
        mtime: file.stat.mtime,
        size: file.stat.size,
        hash: this.hashContent(content)
      });
    }

    const folder = ".system/vault-snapshots";
    const fileName = `snapshot-${snapshot.createdAt.slice(0, 10)}.json`;
    const fullPath = normalizePath(`${folder}/${fileName}`);

    if (!vault.getAbstractFileByPath(folder)) {
      await vault.createFolder(folder);
    }

    await vault.create(fullPath, JSON.stringify(snapshot, null, 2));
    console.log("📸 Snapshot do vault salvo:", fullPath);
  }

  hashContent(content: string): string {
    return createHash("sha1").update(content).digest("hex");
  }
}
