// the browser guest after a release deployed under an open tab: its old chunks are gone from the server
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import { reloadIntoSession } from './joinLink.svelte';

export function watchForNewDeploy(): () => void {
	let shown = false;
	function offerReload() {
		if (shown) return;
		shown = true;
		toaster.warning({
			title: m.session_web_updated_title(),
			description: m.session_web_updated_description(),
			duration: Infinity,
			action: { label: m.session_web_updated_reload(), onClick: reloadIntoSession }
		});
	}
	window.addEventListener('vite:preloadError', offerReload);
	return () => window.removeEventListener('vite:preloadError', offerReload);
}
