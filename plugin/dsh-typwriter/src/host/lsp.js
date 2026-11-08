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
    /** 握手状态：initReqId 是客户端第一次 initialize 的请求 id；
     *  initialized/initResult 是服务端应答过的事实与原文，供进程复用时重放（见 send/#feed） */
    this.initialized = false;
    this.initReqId = null;
    this.initResult = null;
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

  /** 起一个 server；同一根目录且进程活着就复用（不重启）。
   *  渲染端会在开关预览面板、会话重建时短时间内重复 start——无条件 stop+重启会把
   *  刚拿到 preview 端口的进程杀掉，还会跟渲染端的会话重建互相触发成无限循环
   *  （重启→exit→重建→又 start）。已握过手的进程由 send() 重放 initialize 响应接客。 */
  start(root) {
    if (this.child && this.root === root) return { ok: true, command: this.#exe(), reused: true };
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
    this.initialized = false;
    this.initReqId = null;
    this.initResult = null;
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
      // 第一次握手的服务端响应留底：进程复用给下一个客户端时重放（见 send）
      if (!this.initialized && this.initReqId !== null && body.length < 65536) {
        try {
          const res = JSON.parse(body);
          if (res.id === this.initReqId && res.result?.capabilities) {
            this.initialized = true;
            this.initResult = res.result;
          }
        } catch {
          /* 非 JSON 帧：照常转发 */
        }
      }
      this.emit('typst:lsp:message', body);
    }
  }

  /** 渲染端发来的裸 JSON 字符串 */
  send(json) {
    if (!this.child || typeof json !== 'string') return;
    // LSP 的握手只吃一次：进程已握过手时，新客户端的 initialize 由这里重放原响应接住，
    // 不再转发（tinymist 对第二次 initialize 不应答，客户端会等超时——预览"等待首次渲染"的根因）
    if (json.length < 8192) {
      let head;
      try {
        head = JSON.parse(json);
      } catch {
        head = null;
      }
      if (head?.method === 'initialize' && head.id !== undefined) {
        if (this.initialized && this.initResult) {
          const replay = JSON.stringify({ jsonrpc: '2.0', id: head.id, result: this.initResult });
          this.emit('typst:lsp:message', replay);
          return; // initialized 通知等后续帧照常转发，tinymist 幂等接受
        }
        this.initReqId = head.id;
      }
    }
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
