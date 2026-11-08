// tinymist 语言服务器（LSP）宿主：spawn `tinymist lsp`，自己实现 Content-Length 分帧，
// 把裸 JSON 字符串双向转发。
// 这一步同时换来两件事：
//   1) 补全 / 诊断 / 悬停（IntelliSense）
//   2) tinymist 的实时预览 —— 它自带"点 PDF 跳源码"和"光标跟随"，这是 Typst 没有 SyncTeX 的替代品
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const FRAME_HEADER = /Content-Length:\s*(\d+)/i;

export class LspHost {
  /**
   * @param binDir 自带 tinymist 的目录
   * @param emit   (channel, payload) => void  单向下发
   */
  constructor(binDir, emit) {
    this.binDir = binDir;
    this.emit = emit;
    this.child = null;
    this.buf = Buffer.alloc(0);
    this.root = null;
  }

  #exe() {
    const name = process.platform === 'win32' ? 'tinymist.exe' : 'tinymist';
    const full = join(this.binDir, name);
    return existsSync(full) ? full : name;
  }

  #env() {
    const env = { ...process.env };
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const parts = [
      ...(existsSync(this.binDir) ? [this.binDir] : []),
      join(sysRoot, 'System32'),
      join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
      env.PATH || env.Path || ''
    ].filter(Boolean);
    env.PATH = parts.join(';');
    delete env.Path;
    return env;
  }

  /** 起一个 server；已在跑就先停掉（每个窗口一个，和 Texpile 的模型一致） */
  start(root) {
    this.stop();
    const exe = this.#exe();
    let child;
    try {
      child = spawn(exe, ['lsp'], {
        cwd: root && existsSync(root) ? root : process.cwd(),
        env: this.#env(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (e) {
      return { ok: false, error: `无法启动 tinymist: ${e?.message || e}` };
    }
    this.child = child;
    this.root = root;
    this.buf = Buffer.alloc(0);

    child.stdout.on('data', (chunk) => this.#feed(chunk));
    // tinymist 把日志写 stderr；留着最后一小段，进程异常退出时能说明原因
    this.stderrTail = '';
    child.stderr.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-4000);
    });
    child.on('error', (e) => {
      this.emit('typst:lsp:message', null); // 保持通道形状
      console.error('[typwriter] tinymist spawn failed:', e?.message || e);
      this.emit('typst:lsp:exit', null);
    });
    child.on('close', (code) => {
      if (this.stderrTail) {
        console.error(`[typwriter] tinymist exited (${code}); stderr tail:\n${this.stderrTail}`);
      }
      this.child = null;
      this.emit('typst:lsp:exit', code);
    });
    return { ok: true, command: exe };
  }

  /** Content-Length 分帧解析 */
  #feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const sep = this.buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const header = this.buf.subarray(0, sep).toString('ascii');
      const m = FRAME_HEADER.exec(header);
      if (!m) {
        // 头部无法识别：丢掉这帧头，避免死循环
        this.buf = this.buf.subarray(sep + 4);
        continue;
      }
      const len = Number(m[1]);
      const start = sep + 4;
      if (this.buf.length < start + len) return; // 等下一块
      const body = this.buf.subarray(start, start + len).toString('utf8');
      this.buf = this.buf.subarray(start + len);
      this.emit('typst:lsp:message', body);
    }
  }

  /** 渲染端发来的裸 JSON 字符串 */
  send(json) {
    if (!this.child || typeof json !== 'string') return;
    const body = Buffer.from(json, 'utf8');
    const head = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    try {
      this.child.stdin.write(Buffer.concat([head, body]));
    } catch {
      /* stdin 已关 */
    }
  }

  stop() {
    const child = this.child;
    this.child = null;
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
