import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// vite copies public/ into the bundle as is, and the bundle ships inside the installer, so a
// stray folder left there by a dev harness goes out to users; this caught tmp-fixture/ once
const SHIPPED = ['favicon.svg', 'theme-init.js', 'themes'];

describe('public/', () => {
	it('holds only what the app ships', () => {
		const entries = readdirSync(resolve(__dirname, '../../public')).sort();
		expect(entries).toEqual([...SHIPPED].sort());
	});
});
