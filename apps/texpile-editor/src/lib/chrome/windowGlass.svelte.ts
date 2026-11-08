// the see-through window. Main turns the system's blur on behind every window; the page thins its grounds to show it
// (app.css, html.window-glass, where the strengths live)
import { observe } from '$lib/runes/observe.svelte';
import { settings } from '$lib/settings';
import { nativeBridge } from '$lib/workspace/fileSystem';
import { isMac } from '$lib/platform';
import { mountGlassOpaqueFilter } from './windowGlassFilter';

/** false where the system cannot blur behind a window: Linux, and Windows before 11 22H2 */
export const windowGlass = $state({ works: false });

let applied: boolean | null = null;

function apply(): void {
	const on = windowGlass.works && settings.current.transparentWindow === true;
	if (on) mountGlassOpaqueFilter();
	document.documentElement.classList.toggle('window-glass', on);
	document.documentElement.classList.toggle('window-vibrancy', on && isMac);
	if (on === applied) return;
	applied = on;
	void nativeBridge()?.setWindowGlass?.(on);
}

export async function watchWindowGlass(): Promise<void> {
	windowGlass.works = (await nativeBridge()?.windowGlassWorks?.()) === true;
	observe(() => settings.current.transparentWindow, apply);
}
