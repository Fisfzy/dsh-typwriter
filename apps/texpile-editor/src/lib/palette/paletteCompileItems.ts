import { Play, Settings, Square, Terminal, TerminalSquare } from '@lucide/svelte';
import { combo } from '$lib/chrome/shortcutText';
import type { PaletteActions } from '$lib/workspace/commandPalette.svelte';
import type { PaletteItem } from './paletteCommands';
import { m } from '$lib/paraglide/messages';

/** compile first: it is the reason most people reach for a palette in a LaTeX editor */
export function compileItems(a: PaletteActions): PaletteItem[] {
	const items: PaletteItem[] = [];
	const group = m.palette_group_compile();
	if (a.compileAvailable()) {
		items.push(
			a.isCompiling()
				? {
						id: 'compile.stop',
						label: m.palette_stop_compile(),
						group,
						keywords: 'cancel abort kill build',
						hint: combo('Enter', { alt: true }),
						icon: Square,
						run: () => a.stopCompile()
					}
				: {
						id: 'compile.run',
						label: m.menubar_terminal_compile(),
						group,
						keywords: 'build make pdf latex run',
						hint: combo('Enter', { alt: true }),
						icon: Play,
						run: () => a.runCompile()
					}
		);
		items.push({
			id: 'compile.configure',
			label: m.menubar_configure_compile_command(),
			group,
			keywords: 'command latexmk engine settings',
			icon: Settings,
			run: () => a.openCompileModal()
		});
	}
	if (a.terminalAvailable()) {
		items.push({
			id: 'terminal.toggle',
			label: a.terminalVisible() ? m.palette_hide_terminal() : m.menubar_show_terminal(),
			group,
			keywords: 'shell console panel dock',
			icon: Terminal,
			run: () => a.toggleTerminal()
		});
		items.push({
			id: 'terminal.new',
			label: m.menubar_new_terminal(),
			group,
			keywords: 'shell console',
			icon: TerminalSquare,
			run: () => a.newTerminal()
		});
	}
	return items;
}
