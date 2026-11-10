// 插件宿主日志：$DSH_HOME/typwriter/host.log
// 桌面端的宿主 stdout 看不见（GUI 启动，无控制台），所以把关键事件写文件，
// 出问题时能直接定位：LSP 启停/退出、请求排队、RPC 报错、预览页准备结果。
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 512 * 1024;

/**
 * @param {string} dir 日志目录（通常是 $DSH_HOME/typwriter）
 */
export function createLogger(dir) {
  const file = join(dir, 'host.log');
  let ready = false;

  const ensure = () => {
    if (ready) return;
    try {
      mkdirSync(dir, { recursive: true });
      ready = true;
    } catch {
      /* 目录建不出来就静默放弃，不影响功能 */
    }
  };

  return {
    file,
    /** @param {string} line */
    write(line) {
      ensure();
      if (!ready) return;
      try {
        const st = statSync(file, { throwIfNoEntry: false });
        if (st && st.size > MAX_BYTES) renameSync(file, `${file}.1`);
      } catch {
        /* 轮转失败也照写 */
      }
      try {
        appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
      } catch {
        /* ignore */
      }
    }
  };
}
