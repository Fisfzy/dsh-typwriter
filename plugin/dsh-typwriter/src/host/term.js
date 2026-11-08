// 终端：Texpile 的编译不是"编译 API"，而是往终端里敲一条命令行。
// 这里实现一个"看起来像 shell"的命令执行器：收到整行就 spawn 一次 shell 执行它，
// 把 stdout/stderr 当终端数据流回去。会话保持存活，所以连续编译没问题。
// 权衡：不支持交互式命令（我们不跑交互式命令），换来的是比 conpty 简单得多的实现。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const EMIT_BUFFER_LIMIT = 200_000;

/**
 * 解析一个可用的 shell。宿主进程的 PATH 不一定含 System32
 * （实测 DSH 宿主里 `spawn('powershell.exe')` 直接 ENOENT），所以优先用绝对路径。
 * 返回的 name 必须是渲染端认识的：它据此决定 done-sentinel 的语法。
 */
function resolveShell() {
  const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  if (process.platform === 'win32') {
    const candidates = [
      join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'PowerShell.exe')
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        return { exe: c, name: 'powershell', argv: (cmd) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd] };
      }
    }
    const comspec = process.env.ComSpec || process.env.COMSPEC;
    if (comspec && existsSync(comspec)) {
      return { exe: comspec, name: 'cmd', argv: (cmd) => ['/d', '/s', '/c', cmd] };
    }
  }
  const sh = process.env.SHELL || '/bin/sh';
  return { exe: sh, name: 'sh', argv: (cmd) => ['-c', cmd] };
}

export class Terminals {
  /**
   * @param emit (channel, payload) => void  单向下发（SSE）
   * @param binDir 我们自带的 typst/tinymist 目录，加到 PATH 前面
   */
  constructor(emit, binDir) {
    this.emit = emit;
    this.binDir = binDir;
    this.sessions = new Map();
    this.shell = resolveShell();
  }

  #env() {
    const env = { ...process.env };
    // 宿主自带的 PATH 可能极简（实测不含 System32），把系统目录补回去，
    // 否则 shell 内部的 cmd/powershell 内建之外的命令都找不到
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const sysDirs = [
      join(sysRoot, 'System32'),
      join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
      join(sysRoot, 'System32', 'Wbem'),
      sysRoot
    ].filter((d) => existsSync(d));
    const parts = [
      ...(this.binDir && existsSync(this.binDir) ? [this.binDir] : []),
      ...sysDirs,
      env.PATH || env.Path || ''
    ].filter(Boolean);
    env.PATH = parts.join(';');
    // Windows 上同时保留 Path 会让某些程序读到旧值，统一成一个
    delete env.Path;
    delete env.NoDefaultCurrentDirectoryInExePath;
    return env;
  }

  available() {
    return { ok: true };
  }

  spawn({ id, cwd, cols, rows } = {}) {
    if (id == null) return { ok: false, error: 'Missing terminal id' };
    const dir = cwd && existsSync(cwd) ? cwd : homedir();
    const session = {
      id,
      cwd: dir,
      cols: Math.max(1, cols | 0) || 80,
      rows: Math.max(1, rows | 0) || 24,
      buf: '',
      child: null
    };
    this.sessions.set(id, session);
    // 给一句"提示符"，终端不会空着
    const label = dir.replace(/\//g, '\\');
    this.#write(id, `Typwriter shell (${this.shell.name}) · ${label}\r\n`);
    // shell 名字决定渲染端用哪种 done-sentinel 语法，必须和实际执行器一致
    return { ok: true, shell: this.shell.name };
  }

  #write(id, data) {
    if (!data) return;
    const capped = data.length > EMIT_BUFFER_LIMIT ? data.slice(0, EMIT_BUFFER_LIMIT) : data;
    this.emit('terminal:data', { id, data: capped });
  }

  /** 渲染端 write() 进来的原始按键 */
  input({ id, data } = {}) {
    const s = id != null ? this.sessions.get(id) : null;
    if (!s || data == null) return;

    // Ctrl+C：结束当前正在跑的命令
    if (data.includes('\u0003')) {
      if (s.child) {
        try {
          s.child.kill();
        } catch {
          /* already gone */
        }
        s.child = null;
      }
      s.buf = '';
      this.#write(id, '^C\r\n');
      return;
    }

    s.buf += data;
    // 回显（终端观感）
    const echo = data.replace(/\r/g, '\r\n');
    if (echo) this.#write(id, echo);

    let idx;
    while ((idx = s.buf.search(/[\r\n]/)) >= 0) {
      const line = s.buf.slice(0, idx);
      s.buf = s.buf.slice(idx + 1).replace(/^\n/, '');
      const cmd = line.trim();
      if (!cmd) continue;
      this.#runLine(s, cmd);
    }
  }

  #runLine(s, cmd) {
    if (s.child) {
      this.#write(s.id, '上一条命令还在运行，已忽略。\r\n');
      return;
    }
    const child = spawn(this.shell.exe, this.shell.argv(cmd), {
      cwd: s.cwd,
      env: this.#env(),
      windowsHide: true
    });
    s.child = child;
    const pump = (chunk) => this.#write(s.id, chunk.toString('utf8'));
    child.stdout?.on('data', pump);
    child.stderr?.on('data', pump);
    child.on('error', (e) => {
      this.#write(s.id, `\r\n[typwriter] 无法启动 shell: ${e?.message || e}\r\n`);
      s.child = null;
    });
    child.on('close', () => {
      if (s.child === child) s.child = null;
      // 不发送 terminal:exit：会话是持久的，退出消息会让渲染端认为终端没了
    });
  }

  resize({ id, cols, rows } = {}) {
    const s = id != null ? this.sessions.get(id) : null;
    if (!s) return;
    s.cols = Math.max(1, cols | 0) || s.cols;
    s.rows = Math.max(1, rows | 0) || s.rows;
  }

  interrupt({ id } = {}) {
    const s = id != null ? this.sessions.get(id) : null;
    if (!s?.child) return false;
    try {
      s.child.kill();
    } catch {
      /* ignore */
    }
    s.child = null;
    return true;
  }

  kill({ id } = {}) {
    const s = id != null ? this.sessions.get(id) : null;
    if (!s) return;
    if (s.child) {
      try {
        s.child.kill();
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(id);
  }

  killAll() {
    for (const s of this.sessions.values()) {
      if (s.child) {
        try {
          s.child.kill();
        } catch {
          /* ignore */
        }
      }
    }
    this.sessions.clear();
  }
}
