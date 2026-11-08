// Bundle the browser half into the single CJS file the DSH client loader expects:
//   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
// React comes from the loader's require(), so it stays external.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const result = await build({
  entryPoints: [join(root, 'src/client/index.js')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react', 'react-dom', '@deepseek-ai/*'],
  legalComments: 'none',
  logLevel: 'info'
});

const body = result.outputFiles[0].text;
const wrapped =
  `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{` +
  `const module={exports:{}};const exports=module.exports;\n` +
  body +
  `\nreturn module.exports}})\n`;

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/client.js'), wrapped, 'utf8');
console.log(`dist/client.js written (${wrapped.length} B)`);
