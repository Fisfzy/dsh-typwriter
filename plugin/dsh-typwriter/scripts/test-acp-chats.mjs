// 实测：DSH 的 ACP 是否支持 session/list（历史会话）与 session/resume（接续）
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/host/state.js';
import { AcpHost } from '../src/host/acp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(HERE, '..');

const store = new Store();
await store.load();
const workspace = process.argv[2] || store.state?.activeRoot || join(HERE, '..', '_testpaper');
console.log('[test] workspace =', workspace);

const acp = new AcpHost(
  (channel, payload) => {
    if (channel === 'acp:event' && payload?.type === 'state') console.log(`[state] ${payload.state}${payload.detail ? ' — ' + payload.detail : ''}`);
  },
  { binDir: BIN_DIR, command: 'dsh', argsFor: () => ['--profile', 'acp'], workspace: () => workspace }
);

const st = await acp.start();
console.log('[test] start =>', JSON.stringify(st));
if (!st.ok) process.exit(1);

// 历史列表
try {
  const chats = await acp.chats();
  console.log('[test] session/list =>', JSON.stringify(chats, null, 1).slice(0, 1500));
} catch (e) {
  console.log('[test] session/list FAILED:', String(e?.message || e));
}
acp.close();
process.exit(0);
