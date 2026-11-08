// ACP 客户端宿主：驱动 `dsh --profile acp`，把标准 ACP v1 事件翻译成 Texpile 面板认识的形状。
// 协议是 newline-delimited JSON-RPC（一行一个消息）。stdout 里混入的非 JSON 日志直接跳过到 stderr，
// 不需要单独的清洗进程。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { dshHome } from './state.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.texpile', '.workbuddy', 'out', 'output', '__pycache__']);

/** 一轮前后对比用：只记 mtime/size，够判断增删改 */
async function snapshot(root) {
  const map = new Map();
  if (!root || !existsSync(root)) return map;
  async function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full, depth + 1);
      } else if (e.isFile()) {
        try {
          const st = await stat(full);
          map.set(full, `${Math.round(st.mtimeMs)}:${st.size}`);
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(root, 0);
  return map;
}

export class AcpHost {
  /**
   * @param emit    (channel, payload) => void
   * @param options { binDir, command, workspace() }
   */
  constructor(emit, options = {}) {
    this.emit = emit;
    this.binDir = options.binDir;
    this.command = options.command || 'dsh';
    this.argsFor = options.argsFor || (() => ['--profile', 'acp']);
    this.workspace = options.workspace || (() => null);

    this.child = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map(); // requestId -> {resolve, reject}
    this.pendingPermissions = new Map(); // acp requestId -> {resolve}
    this.sessionId = null;
    this.cwd = null;
    this.starting = null;
  }

  #env() {
    const env = { ...process.env };
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const npmDir = join(process.env.APPDATA || '', 'npm');
    const parts = [
      ...(this.binDir && existsSync(this.binDir) ? [this.binDir] : []),
      ...(npmDir && existsSync(npmDir) ? [npmDir] : []),
      join(sysRoot, 'System32'),
      env.PATH || env.Path || ''
    ].filter(Boolean);
    env.PATH = parts.join(';');
    delete env.Path;
    return env;
  }

  /** dsh 是否可用（面板的 detect()） */
  detect() {
    const npmDir = join(process.env.APPDATA || '', 'npm');
    const candidates = ['dsh.cmd', 'dsh.exe', 'dsh.ps1'].map((n) => join(npmDir, n));
    const found = candidates.some((p) => existsSync(p));
    return {
      dsh: found,
      // 其余预设我们没有运行时，直接报"没装"，面板会灰掉而不是点了才失败
      codex: false,
      claude: false,
      opencode: false,
      copilot: false,
      gemini: false
    };
  }

  #write(msg) {
    if (!this.child) return;
    try {
      this.child.stdin.write(JSON.stringify(msg) + '\n');
    } catch {
      /* stdin 关了 */
    }
  }

  #request(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pending.delete(id)) reject(new Error(`${method} 超时（${Math.round(timeoutMs / 1000)}s 无响应）`));
        }, timeoutMs);
      }
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        }
      });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  #notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  /** 一行一行地吃；非 JSON 行改投 stderr */
  #feed(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stderr.write(`[typwriter:acp] non-protocol stdout: ${line.slice(0, 200)}\n`);
        continue;
      }
      this.#onMessage(msg);
    }
  }

  #onMessage(msg) {
    // 服务器的响应
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    // 服务器发来的请求（权限确认）
    if (msg.id !== undefined && msg.method) {
      if (msg.method === 'session/request_permission') {
        this.#askPermission(msg);
        return;
      }
      // 其它请求：明确拒绝，别让服务器一直等
      this.#write({ jsonrpc: '2.0', id: msg.id, result: null });
      return;
    }
    // 通知
    if (msg.method === 'session/update') {
      const update = msg.params?.update;
      if (update) this.emit('acp:event', { type: 'update', update });
      return;
    }
  }

  #askPermission(msg) {
    const id = String(msg.id);
    const params = msg.params || {};
    this.pendingPermissions.set(id, { resolve: (optionId) => {
      this.pendingPermissions.delete(id);
      this.#write({
        jsonrpc: '2.0',
        id: msg.id,
        result: optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }
      });
      this.emit('acp:event', { type: 'permission-done', id });
    } });
    this.emit('acp:event', {
      type: 'permission',
      id,
      toolCall: { title: params.toolCall?.title ?? '需要授权' },
      options: Array.isArray(params.options) ? params.options : []
    });
  }

  /** 启动一个对话：起进程 → initialize → session/new
   *  并发安全：面板可能重复调用 start()，第二次必须复用第一次的结果，
   *  否则第二次的 close() 会把第一次刚开始的子进程杀掉，第一个 Promise 永远不 resolve（表现为一直转圈）。 */
  async start() {
    if (this.starting) return this.starting;
    // 已经有活着的会话：直接复用，不重启进程
    if (this.child && this.sessionId) {
      this.emit('acp:event', { type: 'state', state: 'ready', title: 'DeepSeek Harness', takesSelection: true, takesImages: false, history: true });
      return { ok: true, agent: 'dsh' };
    }
    this.starting = this.#startOnce();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async #startOnce() {
    this.close();
    const cwd = this.workspace();
    if (!cwd) {
      return { ok: false, reason: 'no-folder' };
    }
    if (!this.detect().dsh) {
      return { ok: false, reason: 'missing', program: 'dsh' };
    }
    this.cwd = cwd;
    this.emit('acp:event', { type: 'state', state: 'starting' });

    let child;
    try {
      child = spawn(this.command, this.argsFor(), {
        cwd,
        env: this.#env(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true // Windows 上 dsh.cmd 要靠 shell 解析
      });
    } catch (e) {
      this.emit('acp:event', { type: 'state', state: 'failed', detail: String(e?.message || e) });
      return { ok: false, reason: 'missing', program: this.command };
    }
    this.child = child;
    this.closing = false; // 新子进程：重置上一轮 close() 留下的标记
    this.buf = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => this.#feed(c));
    this.stderrTail = '';
    child.stderr.on('data', (c) => {
      this.stderrTail = (this.stderrTail + c).slice(-4000);
    });
    child.on('error', (e) => {
      this.emit('acp:event', { type: 'state', state: 'failed', detail: String(e?.message || e) });
    });
    child.on('close', (code) => {
      const tail = (this.stderrTail || '').trim().split('\n').slice(-3).join(' ');
      this.child = null;
      this.sessionId = null;
      // 主动 close() 时不报失败
      if (!this.closing) {
        this.emit('acp:event', {
          type: 'state',
          state: 'failed',
          detail: `DSH 进程退出（code ${code}）${tail ? '：' + tail.slice(0, 300) : ''}`
        });
      }
      this.closing = false;
    });

    try {
      await this.#request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }
      });
    } catch (e) {
      this.emit('acp:event', { type: 'state', state: 'failed', detail: `initialize 失败：${e?.message || e}` });
      return { ok: false, reason: 'missing', program: this.command };
    }

    try {
      const res = await this.#request('session/new', { cwd, mcpServers: [] });
      this.sessionId = res?.sessionId ?? null;
      if (!this.sessionId) throw new Error('session/new 未返回 sessionId');
      this.emit('acp:event', {
        type: 'state',
        state: 'ready',
        title: 'DeepSeek Harness',
        takesSelection: true,
        takesImages: false,
        history: true
      });
      return { ok: true, agent: 'dsh' };
    } catch (e) {
      this.emit('acp:event', { type: 'state', state: 'failed', detail: `新建会话失败：${e?.message || e}` });
      return { ok: false, reason: 'failed' };
    }
  }

  /** 一轮对话：前后快照比对出改动清单 */
  async prompt(blocks) {
    if (!this.child || !this.sessionId) return { ok: false, error: '会话未就绪', changes: [] };
    const before = await snapshot(this.cwd);
    this.emit('acp:event', { type: 'state', state: 'working' });
    try {
      const res = await this.#request('session/prompt', {
        sessionId: this.sessionId,
        prompt: Array.isArray(blocks) ? blocks : []
      }, 0); // 一轮对话可能很久，不设超时
      const after = await snapshot(this.cwd);
      const changes = [];
      for (const [path, sig] of after) {
        if (!before.has(path)) changes.push({ path, kind: 'added', before: null });
        else if (before.get(path) !== sig) changes.push({ path, kind: 'modified', before: null });
      }
      for (const path of before.keys()) {
        if (!after.has(path)) changes.push({ path, kind: 'deleted', before: null });
      }
      this.emit('acp:event', { type: 'state', state: 'ready' });
      return { ok: true, stopReason: res?.stopReason ?? null, changes };
    } catch (e) {
      this.emit('acp:event', { type: 'state', state: 'ready' });
      return { ok: false, error: String(e?.message || e), changes: [] };
    }
  }

  cancel() {
    if (this.sessionId) this.#notify('session/cancel', { sessionId: this.sessionId });
    // 取消时把挂起的权限请求一并了结，否则面板会一直等着
    for (const [id, p] of [...this.pendingPermissions]) p.resolve(null);
    this.pendingPermissions.clear();
  }

  answer(id, optionId) {
    const p = this.pendingPermissions.get(String(id));
    if (p) p.resolve(optionId);
  }

  async setConfig(configId, value) {
    if (!this.sessionId) return;
    try {
      await this.#request('session/set_config_option', {
        sessionId: this.sessionId,
        configId,
        value
      });
    } catch {
      /* 不支持就静默 */
    }
  }

  async chats() {
    try {
      const res = await this.#request('session/list', {});
      const list = Array.isArray(res?.sessions) ? res.sessions : [];
      // DSH 的 session/list 不带时间：每个会话在 ~/.dsh/sessions/<编码工作区>/<id> 有目录，
      // 用目录 mtime 补上 updatedAt（一次遍历建映射，列表最多百来条）
      const mtimes = new Map();
      const base = join(dshHome(), 'sessions');
      for (const ws of await readdir(base).catch(() => [])) {
        for (const id of await readdir(join(base, ws)).catch(() => [])) {
          const st = await stat(join(base, ws, id)).catch(() => null);
          if (st?.isDirectory()) mtimes.set(id, st.mtime.toISOString());
        }
      }
      return list.map((s) => {
        const id = String(s.sessionId ?? s.id ?? '');
        return {
          id,
          title: s.title ?? null,
          updatedAt: s.updatedAt ?? mtimes.get(id) ?? null
        };
      });
    } catch {
      return [];
    }
  }

  async openChat(id) {
    try {
      const res = await this.#request('session/resume', { sessionId: id, cwd: this.cwd, mcpServers: [] });
      this.sessionId = res?.sessionId ?? id;
      this.emit('acp:event', { type: 'state', state: 'ready', chat: this.sessionId });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  close() {
    this.closing = true;
    const child = this.child;
    this.child = null;
    this.sessionId = null;
    this.pending.clear();
    this.pendingPermissions.clear();
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

