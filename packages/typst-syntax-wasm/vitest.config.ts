import { defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
	// the parser's glue imports the .wasm as an ES module, which Vite cannot do unaided
	plugins: [wasm()],
	test: {
		include: ['tests/**/*.test.ts']
	},
	// wasm-pack's glue initialises with a top-level await
	esbuild: { target: 'esnext' },
	optimizeDeps: { esbuildOptions: { target: 'esnext' } }
});
