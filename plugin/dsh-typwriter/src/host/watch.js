// 工作区文件监视：对应 Texpile preload 的 `onWorkspaceFsChanged`（'workspace:fs-changed'）。
//
// 这是宿主底层能力，不是 UI 补丁：DSH 里的 Agent/外部工具会直接改磁盘（AI 改稿最常见），
// 没有这个通道，编辑器就只在"自己保存"时才知道内容变了——外部改动永远不刷新、不同步。
//
// 实现用 node:fs.watch(recursive) + 防抖合并，事件语义对齐 Texpile：
//   'added' | 'updated' | 'deleted'  + 绝对路径，一次批量下发。
// 只监视当前工作区根；claim 新目录/关闭工作区时切换或停止。
import { existsSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';

/** 这些目录永远不通知（与 fsops 的 SKIP_DIRS 保持一致） */
const SKIP_SEGMENTS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.texpile', '.workbuddy',
  '__pycache__', '.venv', '.idea', '.vscode', 'out', 'output'
]);

/** 合并窗口：连续保存/批量生成文件时只发一批 */
const DEBOUNCE_MS = 300;
/** 一批最多带的变更数（超出丢多余的，只避免刷屏） */
const MAX_CHANGES = 200;

export class WorkspaceWatcher {
  /**
   * @param emit (channel, payload) => void
   * @param logger 可选宿主日志
   */
  constructor(emit, logger) {
    this.emit = emit;
    this.logger = logger;
    this.watcher = null;
    this.root = null;
    /** path -> 'added'|'updated'|'deleted'（后到的覆盖先到的） */
    this.pending = new Map();
    this.timer = null;
    /** 本次 watch 启动的时间：用于区分"新文件"与"改老文件"（fs.watch 两者都报 change） */
    this.startedAt = 0;
    /** 最近见过的事件路径，第一次见到时用 birthtime 判断是不是新建 */
    this.seen = new Set();
  }

  #log(line) {
    try {
      this.logger?.write?.(line);
    } catch {
      /* ignore */
    }
  }

  /** 切换监视的根目录；null/不存在则停止 */
  setRoot(root) {
    if (this.root === root && (this.watcher || !root)) return;
    this.stop();
    this.root = root || null;
    if (!this.root || !existsSync(this.root)) return;
    this.startedAt = Date.now();
    this.seen.clear();
    try {
      this.watcher = watch(this.root, { recursive: true, persistent: false }, (eventType, filename) => {
        this.#onEvent(eventType, filename);
      });
      this.watcher.on('error', (e) => {
        this.#log(`[watch] watcher error root=${this.root}: ${e?.message || e}`);
      });
      this.#log(`[watch] watching ${this.root}`);
    } catch (e) {
      // 某些平台/路径不支持 recursive watch：安静降级（等同于旧行为：不通知）
      this.#log(`[watch] cannot watch ${this.root}: ${e?.message || e}`);
      this.watcher = null;
    }
  }

  #onEvent(eventType, filename) {
    if (!filename) return;
    const rel = String(filename);
    const segs = rel.split(/[\\/]/);
    if (segs.some((s) => SKIP_SEGMENTS.has(s))) return;
    const full = join(this.root, rel);
    const st = statSync(full, { throwIfNoEntry: false });
    let type;
    if (eventType === 'rename') {
      type = st ? 'added' : 'deleted';
    } else if (!st) {
      // change + 文件不在了：编辑器的"先删后建"中间态，按删除记；后续 added 会覆盖
      type = 'deleted';
    } else if (st.isDirectory()) {
      // 目录内容的每一次写都会顺带报目录 change：没有信息量，丢掉
      return;
    } else if (!this.seen.has(full) && st.birthtimeMs && st.birthtimeMs >= this.startedAt - 2000) {
      // fs.watch 在 Windows 上把"新建文件"也报成 change；用创建时间区分
      type = 'added';
    } else {
      type = 'updated';
    }
    if (type === 'deleted') this.seen.delete(full);
    else this.seen.add(full);
    // 新建文件通常先来 rename 再来 change：后到的 updated 不能把 added 降级（否则
    // 文件树不会刷新出新文件）
    const prev = this.pending.get(full);
    if (prev === 'added' && type === 'updated') type = 'added';
    this.pending.set(full, type);
    this.#schedule();
  }

  #schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.#flush();
    }, DEBOUNCE_MS);
    this.timer.unref?.();
  }

  #flush() {
    if (!this.pending.size) return;
    const changes = [];
    for (const [path, type] of this.pending) {
      changes.push({ type, path });
      if (changes.length >= MAX_CHANGES) break;
    }
    this.pending.clear();
    try {
      this.emit('workspace:fs-changed', changes);
      this.#log(`[watch] emit ${changes.length} change(s)`);
    } catch {
      /* ignore */
    }
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    const watcher = this.watcher;
    this.watcher = null;
    this.root = null;
    if (!watcher) return;
    try {
      watcher.close();
    } catch {
      /* ignore */
    }
  }
}
