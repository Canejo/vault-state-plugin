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
    console.log("📸 Iniciando snapshot do vault");
    const TEXT_EXTENSIONS = [
      "md", "txt", "csv", "json", "js", "ts", "css", "html", "yaml", "yml"
    ];

    const vault = this.app.vault;
    const files = vault.getFiles();

    console.log(`📂 Total de arquivos encontrados: ${files.length}`);

    const snapshot: VaultSnapshot = {
      createdAt: new Date().toISOString(),
      fileCount: files.length,
      files: []
    };

    for (const file of files) {
      const isText = TEXT_EXTENSIONS.includes(file.extension);

      console.log(`📄 ${file.path} (${isText ? "texto" : "binário"})`);
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
    console.log("🧠 Snapshot montado");

    const folder = ".system/vault-snapshots";
    const fileName = `snapshot-${snapshot.createdAt.slice(0, 10)}.json`;
    const fullPath = normalizePath(`${folder}/${fileName}`);

    if (!vault.getAbstractFileByPath(folder)) {
      console.log("📁 Criando pasta:", folder);
      await vault.createFolder(folder);
    }

    await vault.create(fullPath, JSON.stringify(snapshot, null, 2));
    console.log("📸 Snapshot of the saved vault:", fullPath);
  }

  hashContent(content: string): string {
    return createHash("sha1").update(content).digest("hex");
  }
}
