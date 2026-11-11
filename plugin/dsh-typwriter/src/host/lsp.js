// tinymist 语言服务器（LSP）宿主：spawn `tinymist lsp`，自己实现 Content-Length 分帧，
// 把裸 JSON 字符串双向转发。
// 这一步同时换来两件事：
//   1) 补全 / 诊断 / 悬停（IntelliSense）
//   2) tinymist 的实时预览 —— 它自带"点 PDF 跳源码"和"光标跟随"，这是 Typst 没有 SyncTeX 的替代品
//
// 2026-11-10 加固（桌面端首次启动偶发「无法启动 Typst 预览」）：
//   - initialize 应答之前，客户端的其它消息一律排队，等握手完成再发。否则 executeCommand
//     会落到「not initialized yet」，预览直接失败。
//   - 握手完成前的排队有上限与超时，且进程被替换/退出时清空，避免越积越多。
//   - 旧进程被 stop 替换后，它的 close/error 事件不再清掉新进程的引用（以前会丢消息），
//     也会从追踪表里移除；stop/teardown 会杀掉所有遗留子进程。
//   - initialize 消息不再用 8KB 长度猜：直接解析（≤1MB），请求内容大时也能正确重放。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FRAME_HEADER = /Content-Length:\s*(\d+)/i;
/** 超过这个长度的客户端消息不再尝试解析（正常 LSP 消息远小于它） */
const MAX_PARSE_BYTES = 1024 * 1024;
/** 握手前最多排队的客户端消息数（超了就丢最旧的） */
const QUEUE_LIMIT = 400;
/** 握手迟迟不来也不要永久卡住：超时后照常发出去，让服务端自己去报错 */
const QUEUE_TIMEOUT_MS = 20_000;

export class LspHost {
  /**
   * @param binDir 自带 tinymist 的目录
   * @param emit   (channel, payload) => void  单向下发
   * @param logger 可选：{ write(line) } 宿主持久日志
   */
  constructor(binDir, emit, logger, pidFile) {
    this.binDir = binDir;
    this.emit = emit;
    this.logger = logger;
    /** 孤儿清理账本：宿主代际更替（进程被杀/重启）后，旧 LSP 子进程会成为无主孤儿——
     *  编辑器重连只会开新进程，孤儿继续吃内存并让状态排查混乱。构造时按账本收割。 */
    this.pidFile = pidFile ?? null;
    this.#reapOrphans();
    this.child = null;
    this.root = null;
    this.buf = Buffer.alloc(0);
    this.stderrTail = '';
    /** 握手状态：initReqId 是客户端第一次 initialize 的请求 id；
     *  initialized/initResult 是服务端应答过的事实与原文，供进程复用时重放（见 send/#feed） */
    this.initialized = false;
    this.initReqId = null;
    this.initResult = null;
    /** 客户端是否已经发过 initialized 通知；服务端在收到 initialized 之前会拒绝所有请求 */
    this.clientInitializedSent = false;
    /** 我们是否替客户端补发过 initialized（之后客户端真发的那条要吞掉，避免重复） */
    this.synthInitialized = false;
    /** 所有还活着的子进程：stop/teardown 时全部收掉，避免遗留占用内存的 tinymist */
    this.children = new Set();
    /** 握手完成前暂存的客户端消息 */
    this.queue = [];
    this.queueTimer = null;
    /** 每次 start 递增：旧进程的异步事件靠它识别 */
    this.gen = 0;
  }

  #log(line) {
    try {
      this.logger?.write?.(line);
    } catch {
      /* 日志失败不影响协议 */
    }
  }

  #pidFileRead() {
    if (!this.pidFile) return [];
    try {
      const raw = readFileSync(this.pidFile, 'utf8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // 旧格式是裸 pid 数组；新格式 [{pid, owner}]，owner 是写账本的宿主进程。
      // owner 用来避免多实例（desktop + dsh web + dev-server 共用 ~/.dsh）互相误杀。
      return arr
        .map((x) => (Number.isFinite(x) ? { pid: x, owner: null } : x))
        .filter((x) => x && Number.isFinite(x.pid));
    } catch {
      return [];
    }
  }

  #pidFileWrite(entries) {
    if (!this.pidFile) return;
    try {
      const seen = new Set();
      const out = [];
      for (const e of entries) {
        const pid = typeof e === 'number' ? e : e?.pid;
        if (!Number.isFinite(pid) || seen.has(pid)) continue;
        seen.add(pid);
        out.push(typeof e === 'number' ? { pid, owner: null } : { pid, owner: e.owner ?? null });
      }
      writeFileSync(this.pidFile, JSON.stringify(out));
    } catch {
      /* 账本写失败不影响协议 */
    }
  }

  #alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** 按账本收割上一代宿主遗留的 LSP 孤儿（新宿主自己的进程不在此列）。
   *  多实例共用一个 DSH_HOME 时，别的**活着的**宿主登记的进程绝不能杀——
   *  实测旧逻辑会杀掉 dsh web 实例的 tinymist。 */
  #reapOrphans() {
    const keep = [];
    for (const entry of this.#pidFileRead()) {
      if (entry.pid === process.pid) continue;
      if (entry.owner !== null && entry.owner !== undefined && this.#alive(entry.owner)) {
        keep.push(entry); // 另一个活着的实例的进程：保留账本条目，不动进程
        continue;
      }
      if (entry.owner === null || entry.owner === undefined) {
        // 旧格式无法判断归属：保守起见不杀，只丢弃过期条目
        continue;
      }
      try {
        process.kill(entry.pid, 9);
        this.#log(`[lsp] reaped orphan pid=${entry.pid} owner=${entry.owner}`);
      } catch {
        /* 已经不在了：正好 */
      }
    }
    this.#pidFileWrite(keep);
  }

  #recordPid(pid) {
    if (!this.pidFile) return;
    try {
      const entries = this.#pidFileRead();
      entries.push({ pid, owner: process.pid });
      this.#pidFileWrite(entries);
    } catch {
      /* ignore */
    }
  }

  #forgetPid(pid) {
    if (!this.pidFile) return;
    try {
      this.#pidFileWrite(this.#pidFileRead().filter((x) => x.pid !== pid));
    } catch {
      /* ignore */
    }
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
      this.#log(`[lsp] spawn failed root=${root}: ${e?.message || e}`);
      return { ok: false, error: `无法启动 tinymist: ${e?.message || e}` };
    }
    this.child = child;
    this.root = root;
    this.gen += 1;
    const gen = this.gen;
    this.children.add(child);
    this.#recordPid(child.pid);
    this.initialized = false;
    this.initReqId = null;
    this.initResult = null;
    this.clientInitializedSent = false;
    this.synthInitialized = false;
    this.buf = Buffer.alloc(0);
    this.stderrTail = '';
    this.#clearQueue();
    this.#log(`[lsp] start gen=${gen} pid=${child.pid} root=${root}`);

    child.stdout.on('data', (chunk) => this.#feed(chunk));
    // tinymist 把日志写 stderr；留着最后一小段，进程异常退出时能说明原因
    child.stderr.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-4000);
    });
    child.on('error', (e) => {
      this.#log(`[lsp] error gen=${gen} pid=${child.pid}: ${e?.message || e}`);
      if (this.child !== child) return; // 已被新进程替换：不要动新进程的状态
      this.#clearQueue();
      this.emit('typst:lsp:message', null); // 保持通道形状
      this.emit('typst:lsp:exit', null);
      this.child = null;
    });
    child.on('close', (code) => {
      this.children.delete(child);
      this.#forgetPid(child.pid);
      // 只有"当前"进程退出才通知渲染端；被替换掉的旧进程退出发出的 exit
      // 会让渲染端误以为服务挂了，触发会话重建→再 start 的循环
      if (this.child !== child) {
        this.#log(`[lsp] stale child exited gen=${gen} pid=${child.pid} code=${code}`);
        return;
      }
      this.#log(`[lsp] exit gen=${gen} pid=${child.pid} code=${code}${this.stderrTail ? ` stderr=${this.stderrTail.slice(-300)}` : ''}`);
      this.child = null;
      this.#clearQueue();
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
            // 服务端在收到 initialized 通知前会拒绝所有请求（-32002 not initialized yet）。
            // 客户端收到回包后才会发 initialized，而排队的请求此刻就要放行——所以由宿主
            // 先补发一条 initialized；客户端稍后真发的那条会被 send() 吞掉。
            if (!this.clientInitializedSent) {
              this.synthInitialized = true;
              this.#write(this.child, JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));
            }
            this.#log(`[lsp] initialized gen=${this.gen} pid=${this.child?.pid ?? '?'} queued=${this.queue.length}`);
          }
        } catch {
          /* 非 JSON 帧：照常转发 */
        }
      }
      this.emit('typst:lsp:message', body);
      if (this.initialized && this.queue.length) this.#flushQueue();
    }
  }

  #frame(json) {
    const body = Buffer.from(json, 'utf8');
    const head = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    return Buffer.concat([head, body]);
  }

  #write(child, json) {
    if (!child) return;
    try {
      child.stdin.write(this.#frame(json));
    } catch {
      /* stdin 已关 */
    }
  }

  /** 握手完成前暂存；有上限，超时后强制放行 */
  #queueFrame(json) {
    this.queue.push(json);
    while (this.queue.length > QUEUE_LIMIT) this.queue.shift();
    if (!this.queueTimer) {
      this.queueTimer = setTimeout(() => {
        this.queueTimer = null;
        if (!this.initialized && this.queue.length) {
          this.#log(`[lsp] handshake timeout (${QUEUE_TIMEOUT_MS}ms), flushing ${this.queue.length} queued frame(s)`);
          this.#flushQueue();
        }
      }, QUEUE_TIMEOUT_MS);
      this.queueTimer.unref?.();
    }
  }

  #flushQueue() {
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
    const pending = this.queue;
    this.queue = [];
    const child = this.child;
    if (!child) return;
    for (const json of pending) this.#write(child, json);
    if (pending.length) this.#log(`[lsp] flushed ${pending.length} queued frame(s) gen=${this.gen}`);
  }

  #clearQueue() {
    this.queue = [];
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
  }

  /** 渲染端发来的裸 JSON 字符串 */
  send(json) {
    if (!this.child || typeof json !== 'string') return;
    let head = null;
    if (json.length <= MAX_PARSE_BYTES) {
      try {
        head = JSON.parse(json);
      } catch {
        head = null;
      }
    }
    // LSP 的握手只吃一次：进程已握过手时，新客户端的 initialize 由这里重放原响应接住，
    // 不再转发（tinymist 对第二次 initialize 不应答，客户端会等超时——预览"等待首次渲染"的根因）
    if (head?.method === 'initialize' && head.id !== undefined) {
      if (this.initialized && this.initResult) {
        const replay = JSON.stringify({ jsonrpc: '2.0', id: head.id, result: this.initResult });
        this.emit('typst:lsp:message', replay);
        this.#log(`[lsp] replayed initialize id=${head.id} gen=${this.gen}`);
        return; // initialized 通知等后续帧照常转发，tinymist 幂等接受
      }
      this.initReqId = head.id;
      this.#write(this.child, json);
      return;
    }
    // initialized 通知：如果宿主已经替客户端补发过，吞掉这一条
    if (head?.method === 'initialized') {
      if (this.synthInitialized) {
        this.synthInitialized = false;
        this.clientInitializedSent = true;
        return;
      }
      if (!this.initialized) {
        this.#queueFrame(json);
        return;
      }
      this.clientInitializedSent = true;
      this.#write(this.child, json);
      return;
    }
    // 还没握手：先排队，等 initialize 应答（预览的 executeCommand 提前到达时就是这里兜住的）
    if (!this.initialized) {
      this.#queueFrame(json);
      return;
    }
    this.#write(this.child, json);
  }

  stop() {
    const kids = [...this.children];
    this.children.clear();
    this.child = null;
    this.#clearQueue();
    for (const child of kids) {
      try {
        child.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      // spawn 还没完成时 kill 可能落空：等 spawn 事件再补一刀
      if (!child.pid) child.once('spawn', () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      });
    }
    if (kids.length) this.#log(`[lsp] stop killed ${kids.length} child(ren)`);
  }
}
