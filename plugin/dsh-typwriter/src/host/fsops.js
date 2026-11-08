// 文件系统算子：实现 Texpile 需要的 fs:* 通道，直接走 node:fs（插件宿主就是 Node 进程）。
// 返回结构对齐 apps/texpile-editor/src/lib/workspace/fileSystem.ts：
//   TexFile = {name, path, relPath}   TreeEntry = {name, path, type:'dir'|'file', children?}
//   SourceRead = {text, encoding}
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

// scanTexFiles 不传 exts 时的默认集合
const DEFAULT_EXTS = [
  '.typ', '.tex', '.md', '.bib', '.bbl', '.cls', '.sty', '.bst',
  '.yaml', '.yml', '.toml', '.json', '.csv', '.txt', '.cff', '.lua'
];

// 这些目录永远不进文件树
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.texpile', '.workbuddy',
  '__pycache__', '.venv', '.idea', '.vscode'
]);

const MAX_FILES = 20000;
const MAX_DEPTH = 24;

const toPosix = (p) => p.split(sep).join('/');

function parseExts(exts) {
  if (!exts) return DEFAULT_EXTS;
  const list = Array.isArray(exts) ? exts : String(exts).split(',');
  const out = list
    .map((e) => {
      const t = String(e).trim().toLowerCase();
      if (!t) return null;
      return t.startsWith('.') ? t : `.${t}`;
    })
    .filter(Boolean);
  return out.length ? out : DEFAULT_EXTS;
}

/** 一次遍历同时产出 children（整棵树）与 files（文档清单） */
async function scanInto(root, dir, exts, children, files, depth) {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1;
    const bd = b.isDirectory() ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name, 'zh-Hans');
  });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      const node = { name: e.name, path: full, type: 'dir', children: [] };
      children.push(node);
      await scanInto(root, full, exts, node.children, files, depth + 1);
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf('.');
      const ext = dot > 0 ? e.name.slice(dot).toLowerCase() : '';
      children.push({ name: e.name, path: full, type: 'file' });
      if (ext && exts.includes(ext)) {
        files.push({ name: e.name, path: full, relPath: toPosix(relative(root, full)) });
      }
    }
  }
}

export async function fsTreeScan(root, exts) {
  const children = [];
  const files = [];
  await scanInto(root, root, parseExts(exts), children, files, 0);
  return { root, children, files };
}

export async function fsScan(root, exts) {
  const { files } = await fsTreeScan(root, exts);
  return { root, files };
}

export async function fsTree(root) {
  const { root: r, children } = await fsTreeScan(root, DEFAULT_EXTS);
  return { root: r, children };
}

/** 编码嗅探：Texpile 只写 UTF-8，其它编码打开为只读 */
function detectEncoding(buf) {
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le';
    if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf16be';
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf8bom';
  const probe = buf.subarray(0, 8192);
  for (let i = 0; i < probe.length; i++) if (probe[i] === 0) return 'binary';
  return 'utf8';
}

export async function fsRead(path) {
  const buf = await readFile(path);
  const encoding = detectEncoding(buf);
  if (encoding === 'utf16le') return { content: buf.toString('utf16le'), encoding };
  if (encoding === 'utf8bom') return { content: buf.subarray(3).toString('utf8'), encoding };
  if (encoding === 'binary') return { content: '', encoding };
  return { content: buf.toString('utf8'), encoding };
}

export async function fsWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return { ok: true };
}

export async function fsWriteBinary(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await writeFile(path, buf);
  return { ok: true };
}

export async function fsStat(path) {
  try {
    const st = await stat(path);
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size, isDirectory: st.isDirectory() };
  } catch {
    return { exists: false, mtimeMs: 0, size: 0, isDirectory: false };
  }
}

export async function fsProbe(path) {
  const st = await stat(path).catch(() => null);
  if (!st || !st.isFile()) return { size: 0, binary: true };
  const buf = await readFile(path).catch(() => Buffer.alloc(0));
  return { size: st.size, binary: detectEncoding(buf) === 'binary' };
}

export async function fsRealRelative(root, rel) {
  try {
    const real = await realpath(join(root, rel));
    const realRoot = await realpath(root);
    const r = relative(realRoot, real);
    return r.startsWith('..') ? null : r;
  } catch {
    return null;
  }
}

/** fsOp：create / delete / rename / copy */
export async function fsOp(body = {}) {
  const action = body.action;
  try {
    if (action === 'create') {
      const p = String(body.path || '');
      if (body.type === 'dir') {
        await mkdir(p, { recursive: true });
      } else {
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, String(body.content ?? ''), 'utf8');
      }
      return { ok: true };
    }
    if (action === 'delete') {
      await rm(String(body.path || ''), { recursive: true, force: true });
      return { ok: true };
    }
    if (action === 'rename') {
      await mkdir(dirname(String(body.to || '')), { recursive: true });
      await rename(String(body.from || ''), String(body.to || ''));
      return { ok: true };
    }
    if (action === 'copy') {
      const { cp } = await import('node:fs/promises');
      await cp(String(body.from || ''), String(body.to || ''), { recursive: true });
      return { ok: true };
    }
    return { ok: false, error: `unsupported fs op: ${action}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** fsTrash：直接删（不做系统回收站），保留接口形状 */
export async function fsTrash(body = {}) {
  try {
    await rm(String(body.path || ''), { recursive: true, force: true });
    return { backup: null, recycled: false, kept: false };
  } catch (e) {
    return { backup: null, recycled: false, error: String(e?.message || e) };
  }
}

export async function fsPurgeUndo() {
  return { ok: true };
}

/** fsSearch */
export async function fsSearch(root, q, regex, caseSensitive) {
  const query = String(q ?? '');
  if (!query) return { results: [], truncated: false, total: 0 };
  let test;
  if (regex) {
    try {
      const re = new RegExp(query, caseSensitive ? '' : 'i');
      test = (line) => re.test(line);
    } catch {
      return { results: [], truncated: false, error: 'invalid pattern' };
    }
  } else {
    const needle = caseSensitive ? query : query.toLowerCase();
    test = (line) => (caseSensitive ? line.includes(needle) : line.toLowerCase().includes(needle));
  }
  const { files } = await fsScan(root);
  const results = [];
  let total = 0;
  const MAX_MATCHES = 2000;
  for (const f of files) {
    let text;
    try {
      text = await readFile(f.path, 'utf8');
    } catch {
      continue;
    }
    if (text.length > 4 * 1024 * 1024) continue;
    const lines = text.split(/\r?\n/);
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (test(lines[i])) {
        total++;
        if (matches.length < 200) matches.push({ line: i + 1, text: lines[i].slice(0, 400) });
      }
    }
    if (matches.length) results.push({ file: f.path, rel: f.relPath, matches });
    if (total >= MAX_MATCHES) break;
  }
  return { results, truncated: total >= MAX_MATCHES, total };
}

/** fsFormatLatex：不实现 LaTeX 格式化，原样返回，避免编辑器报错 */
export async function fsFormatLatex(_path, text) {
  return { formatted: String(text ?? '') };
}
