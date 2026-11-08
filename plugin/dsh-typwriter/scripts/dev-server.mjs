// 独立开发宿主：把插件的 host 半片挂到一个普通 Node HTTP 服务上，
// 用一个假的 ctx 提供 webServer / connection，从而在不改动运行中的 DSH 的前提下
// 完整验证：静态路由、bootstrap 注入、shim、RPC、文件读写、终端编译。
//
// 用法：node scripts/dev-server.mjs [port] [rootFolder]
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] || 4400);
const ROOT = process.argv[3] || null;

const routes = [];
const disposers = [];

const fakeCtx = {
  get(name) {
    if (name === 'connection') {
      return {
        // 开发宿主不做鉴权：返回 undefined = 放行
        requestRejection() {
          return undefined;
        }
      };
    }
    return undefined;
  },
  effect(fn) {
    const d = fn();
    if (typeof d === 'function') disposers.push(d);
    return d;
  },
  webServer: {
    register(route) {
      routes.push(route);
      return () => {
        const i = routes.indexOf(route);
        if (i >= 0) routes.splice(i, 1);
      };
    }
  }
};

const mod = await import('../src/host/index.js');
const plugin = mod.default;
console.log('[dev] plugin name =', mod.name, 'inject =', plugin.inject);
plugin.apply(fakeCtx);

// 若给了 root，先写进 state，让 bootstrap 直接打开它
if (ROOT) {
  const { Store } = await import('../src/host/state.js');
  const store = new Store();
  await store.setActiveRoot(ROOT);
  console.log('[dev] activeRoot =', ROOT);
}

function match(route, pathname) {
  return route.kind === 'prefix'
    ? pathname === route.path || pathname.startsWith(route.path + '/')
    : pathname === route.path;
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  // 最长前缀优先，exact 优先
  const sorted = [...routes].sort((a, b) => b.path.length - a.path.length);
  const route = sorted.find((r) => match(r, pathname));
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('no route: ' + pathname);
    return;
  }
  Promise.resolve(route.handler(req, res)).catch((e) => {
    console.error('[dev] handler failed', e);
    if (!res.headersSent) res.writeHead(500).end(String(e?.message || e));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev] http://127.0.0.1:${PORT}/typwriter/`);
  console.log('[dev] routes:');
  for (const r of routes) console.log(`   ${r.kind.padEnd(6)} ${r.path}`);
});
