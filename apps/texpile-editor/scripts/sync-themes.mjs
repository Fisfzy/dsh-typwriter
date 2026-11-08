// Copies Skeleton's preset themes into public/themes/ and writes themes/index.json: each theme's
// name, label and the five colours a picker tile needs (its primary, both grounds, both panels).
// Runs from `pnpm sync`, so the files track the installed Skeleton version instead of living in git.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@skeletonlabs/skeleton/src/themes');
const out = join(root, 'public/themes');
mkdirSync(out, { recursive: true });

// file names are lower-case single words; the two that are really two words get their spelling back
const LABELS = { rosepine: 'Rosé Pine', hamlindigo: 'Hamlindigo' };

const MOST_REM = { '--radius-base': 0.5, '--radius-container': 0.75 };
function cappedCorners(css) {
	return css.replace(/(--radius-(?:base|container)):\s*([\d.]+)rem;/g, (all, name, rem) =>
		Number(rem) > MOST_REM[name] ? `${name}: ${MOST_REM[name]}rem;` : all
	);
}

const ABSOLUTE_LIGHTNESS = { 50: 100, 100: 96.5, 200: 92, 300: 86, 400: 72, 500: 58, 600: 46, 700: 33, 800: 24, 900: 15, 950: 0 };
function absoluteFrom(css) {
	let out = css.replace("[data-theme='theme']", "[data-theme='absolute']");
	for (const [step, l] of Object.entries(ABSOLUTE_LIGHTNESS))
		out = out.replace(new RegExp(`(--color-surface-${step}): [^;]+;`), `$1: oklch(${l}% 0 none);`);
	return out;
}

function swatch(css) {
	const get = (name) => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
	const s = {
		primary: get('--color-primary-500'),
		surfaceLight: get('--color-surface-50'),
		surfaceDark: get('--color-surface-950'),
		panelLight: get('--color-surface-200'),
		panelDark: get('--color-surface-800')
	};
	return Object.values(s).every(Boolean) ? s : null;
}

const defaultCss = readFileSync(join(root, 'texpile-default-theme.css'), 'utf8');
const absoluteCss = absoluteFrom(defaultCss);
writeFileSync(join(out, 'absolute.css'), absoluteCss);
const entries = [
	{ name: 'theme', label: 'Texpile', swatch: swatch(defaultCss) },
	{ name: 'absolute', label: 'Absolute', swatch: swatch(absoluteCss) }
];
for (const file of readdirSync(src)
	.filter((f) => f.endsWith('.css'))
	.sort()) {
	const name = file.slice(0, -4);
	const css = readFileSync(join(src, file), 'utf8');
	const s = swatch(css);
	if (!s) continue;
	writeFileSync(join(out, file), cappedCorners(css));
	entries.push({ name, label: LABELS[name] ?? name[0].toUpperCase() + name.slice(1), swatch: s });
}
writeFileSync(join(out, 'index.json'), JSON.stringify(entries));
console.log(`themes: ${entries.length - 1} presets + default -> public/themes`);
