// The fork ships zh-Hans as the default UI locale (a product decision, DEFAULTS in settings.ts),
// while the inherited test suite asserts English strings throughout. Any test whose setup loads
// settings switches the Paraglide runtime to zh-Hans, and English assertions later in the same
// file would read Chinese. Pin the runtime back to the base locale before every test: assertions
// stay English and deterministic on every machine. Tests that cover locale application itself
// (settings.test.ts) load settings inside the test, after this reset, and still see their value.
import { beforeEach } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';

beforeEach(() => {
	try {
		setLocale('en');
	} catch {
		/* the node-environment files have no document to write the cookie to; the base locale already applies there */
	}
});
