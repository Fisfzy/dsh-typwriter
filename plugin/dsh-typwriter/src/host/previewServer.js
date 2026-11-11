// 预览页的 loopback HTTP 原点。
//
// 为什么不能同源提供（/typwriter/preview-page 的老做法）：
// tinymist 的数据面 websocket 会校验握手的 Origin 头（它自己的 tool/preview/http.rs，
// 目的是让 loopback 服务不被机器上别的网页借用）。它只接受三类来源：
//   1) 它自己 http://<preview-host>:<port>
//   2) vscode-webview://…
//   3) 任意 http://127.0.0.1 或 http://localhost 上的页面
//
// DSH 桌面端的页面原点是 dsh-app://app（Electron 自定义安全 scheme），预览页若同源提供，
// 握手 Origin 就是 dsh-app://app → tinymist 直接断开（1006），界面显示
// 「预览页面无法连接到 tinymist。」——这正是实机安装时的第二个故障。
//
// 实测（同一 tinymist 进程，原始 WebSocket 握手）：
//   Origin: dsh-app://app          → 连接被关闭，无 101
//   Origin: http://127.0.0.1:9999  → 101 Switching Protocols
//
// 结论与 Texpile 的 Electron 版一致：预览页必须从 127.0.0.1 的 http 原点提供，
// 再由渲染端跨源 iframe 嵌入。postMessage 桥本来就是跨源设计的，不需要同源。

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

// 页面只需要：内联脚本/内联样式、内联 wasm、data:/blob: 图片字体、以及连 tinymist 的
// loopback http/ws。其余一律关掉（与 Texpile electron/src/ipc/typstPreviewIpc.ts 同源策略一致）。
const HOST_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval' data:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'connect-src ws://127.0.0.1:* http://127.0.0.1:* data: blob:',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

/** 同时留存的页面数上限：每次切主题就会准备一份新的，不设上限会一直吃内存 */
const MAX_PAGES = 24;

export class PreviewPageServer {
  /** @param logger 可选宿主日志：页面桥脚本的 /diag 上报会写进去 */
  constructor(logger) {
    this.logger = logger;
    this.server = null;
    this.port = 0;
    this.starting = null;
    /** id -> 准备好的 HTML（已注入主题与桥脚本） */
    this.pages = new Map();
  }

  /** 惰性启动；并发调用共享同一次 listen */
  async #ensure() {
    if (this.server && this.port) return this.port;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.#handle(req, res));
      server.once('error', (e) => {
        this.starting = null;
        reject(e);
      });
      // 只绑 loopback：这个页面是给本机浏览器用的，不对外
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        this.server = server;
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        this.starting = null;
        resolve(this.port);
      });
    }).catch((e) => {
      this.starting = null;
      throw e;
    });
    return this.starting;
  }

  #handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    // 预览页桥脚本的诊断上报：桌面端出问题时不用打开 DevTools，直接看 host.log
    if (url.pathname === '/diag' && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= 8192) chunks.push(c);
      });
      req.on('end', () => {
        try {
          this.logger?.write?.('[diag] ' + Buffer.concat(chunks).toString('utf8').slice(0, 4000));
        } catch {
          /* ignore */
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD, POST' });
      res.end();
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, pages: this.pages.size }));
      return;
    }
    const m = /^\/p\/([a-f0-9]{16,64})$/.exec(url.pathname);
    const page = m ? this.pages.get(m[1]) : null;
    if (!page) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('preview page not found');
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(page),
      // 页面是 tinymist 二进制内嵌的那份 + 我们的注入，随会话变化，不能缓存
      'cache-control': 'no-store',
      'content-security-policy': HOST_PAGE_CSP,
      'referrer-policy': 'no-referrer'
    });
    if (req.method === 'HEAD') res.end();
    else res.end(page);
  }

  /**
   * 登记一份准备好的页面，返回可直接作为 iframe src 的绝对 URL。
   * @param {string} html 已注入主题/桥脚本的预览页
   * @returns {Promise<string>} http://127.0.0.1:<port>/p/<id>
   */
  async serve(html) {
    const port = await this.#ensure();
    const id = randomBytes(16).toString('hex');
    this.pages.set(id, String(html));
    while (this.pages.size > MAX_PAGES) {
      const oldest = this.pages.keys().next().value;
      this.pages.delete(oldest);
    }
    return `http://127.0.0.1:${port}/p/${id}`;
  }

  /** 插件卸载时调用：关服务、丢页面 */
  close() {
    this.pages.clear();
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (!server) return;
    try {
      server.close();
    } catch {
      /* ignore */
    }
    try {
      server.closeAllConnections?.();
    } catch {
      /* ignore */
    }
  }
}
