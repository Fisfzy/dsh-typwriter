// 持久化：$DSH_HOME/typwriter/state.json
// 保存 Texpile 的 settings 与"当前打开的论文文件夹"。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function dshHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), '.dsh');
}

const EMPTY = { activeRoot: null, settings: {} };

export class Store {
  constructor(root = join(dshHome(), 'typwriter')) {
    this.root = root;
    this.file = join(root, 'state.json');
    this.state = null;
    this.saving = null;
  }

  async load() {
    if (this.state) return this.state;
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = { ...EMPTY, ...parsed };
    } catch {
      this.state = { ...EMPTY };
    }
    return this.state;
  }

  /** serialized writes; a crash mid-write cannot truncate the file (tmp + rename) */
  async save(patch) {
    const next = { ...(await this.load()), ...patch };
    this.state = next;
    this.saving = (this.saving || Promise.resolve()).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await rename(tmp, this.file);
    }).catch((e) => {
      console.error('[typwriter] state save failed', e);
    });
    return this.saving.then(() => next);
  }

  async getSettings() {
    return (await this.load()).settings || {};
  }

  async setSettings(partial) {
    const cur = await this.getSettings();
    const next = { ...cur, ...(partial || {}) };
    await this.save({ settings: next });
    return next;
  }

  async getActiveRoot() {
    return (await this.load()).activeRoot || null;
  }

  async setActiveRoot(root) {
    await this.save({ activeRoot: root });
    return root;
  }
}
