<script lang="ts">
	// An HTML file previewed AS the page it is. Every other body in this pane is a compiler's
	// output (a streamed Typst preview, a live LaTeX draft, a compiled PDF); HTML has no compiler,
	// the file is already the artifact, so the pane loads it and reloads when it changes on disk.
	import { basename } from '$lib/workspace/fileSystem';
	import { fileService } from '$lib/files/service/fileService';

	type Props = {
		path: string;
		/** a splitter is being dragged; keep the frame from re-laying out every frame */
		paneDragging?: boolean;
	};
	let { path, paneDragging = false }: Props = $props();

	/** the file's mtime, as the cache-buster: the file route answers a 304 until it moves */
	let stamp = $state(0);
	$effect(() => {
		const target = path;
		let live = true;
		async function poll() {
			const st = await fileService.stat(target).catch(() => null);
			if (live && st?.exists) stamp = Math.round(st.mtimeMs);
		}
		void poll();
		// 1s: the editor's own autosave runs on a similar beat, so a save shows up about as fast
		const timer = setInterval(() => void poll(), 1000);
		return () => {
			live = false;
			clearInterval(timer);
		};
	});

	const src = $derived(`${fileService.fileUrl(path)}&t=${stamp}`);
</script>

<!-- Scripts run, but in an opaque origin: the page is someone's document, not part of the
     workbench, so it must not reach this window, its storage or its bridge. -->
<iframe
	class="h-full w-full border-0 bg-white"
	class:pointer-events-none={paneDragging}
	title={basename(path)}
	{src}
	sandbox="allow-scripts allow-forms allow-popups allow-modals"
></iframe>
