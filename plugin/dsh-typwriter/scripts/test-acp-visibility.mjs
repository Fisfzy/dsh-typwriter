// 实测：Typwriter 侧边栏的 agent（dsh --profile acp）能否读到 DSH 本身的技能与插件。
// 与面板走完全相同的代码路径（src/host/acp.js 的 AcpHost）。
// 用法：node scripts/test-acp-visibility.mjs [workspaceDir]
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, dshHome } from '../src/host/state.js';
import { AcpHost } from '../src/host/acp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(HERE, '..');

const store = new Store();
await store.load();
const workspace = process.argv[2] || store.state?.activeRoot || join(HERE, '..', '_testpaper');
console.log(`[test] workspace = ${workspace}`);
console.log(`[test] dsh home  = ${dshHome()}`);

const events = [];
const acp = new AcpHost(
  (channel, payload) => {
    if (channel !== 'acp:event') return;
    if (payload?.type === 'state') {
      console.log(`[state] ${payload.state}${payload.detail ? ' — ' + payload.detail : ''}`);
      return;
    }
    if (payload?.type === 'update') {
      const u = payload.update ?? {};
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
        process.stdout.write(u.content.text);
      } else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        const title = u.toolCall?.title ?? JSON.stringify(u.toolCall?.kind ?? '');
        console.log(`\n[tool] ${title}`);
        events.push(u.toolCall?.title ?? '');
      }
    }
  },
  { binDir: BIN_DIR, command: 'dsh', argsFor: () => ['--profile', 'acp'], workspace: () => workspace }
);

const st = await acp.start();
console.log('[test] start =>', JSON.stringify(st));
if (!st.ok) process.exit(1);

const t0 = Date.now();
const r = await acp.prompt([
  {
    type: 'text',
    text:
      '这是一次环境自检，请不要修改任何文件。请分别回答：1) 你当前会话里可用的 Skill（技能）名字列表，如果没有就明说"没有已加载的技能"；2) 你当前可用的工具（tool）名字列表；3) 你运行在哪个家目录/用户级配置下（如果能判断）。简短作答。'
  }
]);
console.log(`\n\n[test] prompt => ok=${r.ok} stopReason=${r.stopReason} 耗时 ${Math.round((Date.now() - t0) / 1000)}s`);
console.log('[test] tool calls:', JSON.stringify(events));
acp.close();
process.exit(0);
