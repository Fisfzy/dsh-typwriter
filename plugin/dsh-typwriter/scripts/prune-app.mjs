// Prune the built Texpile app down to what the Typst workbench uses.
//
// The full Texpile bundle carries three large, optional feature sets:
//   - spell/                  CSpell dictionaries for 8 non-English languages (~14 MB)
//   - assets/data/            the CTAN package metadata used by LaTeX completion (~23 MB, ~6900 files)
//   - assets/harper_wasm_*     Harper grammar/spell checking (~19 MB)
//   - live-preview-demo*.mp4   the start screen's demo video (~1.4 MB)
//
// Missing package JSONs already fall back to the built-in base table in bundledFiles.ts, and a
// failed dictionary fetch is caught by the spelling worker; removing the Harper wasm disables
// grammar checking. Typst editing, compiling, previewing and the agent panel do not need any of it.
//
// Usage: node scripts/prune-app.mjs [appDir]   (default: ../app)
import { readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = process.argv[2] ? process.argv[2] : join(root, 'app');

async function sizeOf(dir) {
  let bytes = 0;
  let files = 0;
  async function walk(at) {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        try {
          bytes += (await stat(full)).size;
          files += 1;
        } catch {
          /* raced with a rebuild */
        }
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}

async function remove(path, label) {
  try {
    await stat(path);
  } catch {
    console.log(`skip ${label} (absent)`);
    return;
  }
  await rm(path, { recursive: true, force: true });
  console.log(`removed ${label}`);
}

const before = await sizeOf(appDir);
await remove(join(appDir, 'spell'), 'spell/ dictionaries');
await remove(join(appDir, 'assets', 'data'), 'assets/data/ CTAN metadata');

const assetsDir = join(appDir, 'assets');
let names = [];
try {
  names = await readdir(assetsDir);
} catch {
  /* a build without assets */
}
for (const name of names) {
  if (/^harper_wasm_.*\.wasm$/.test(name)) await remove(join(assetsDir, name), `assets/${name}`);
  if (/^live-preview-demo.*\.mp4$/.test(name)) await remove(join(assetsDir, name), `assets/${name}`);
}

const after = await sizeOf(appDir);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`slim app: ${mb(after.bytes)} MB / ${after.files} files (was ${mb(before.bytes)} MB / ${before.files} files)`);
