// menus, dialogs and the macOS vibrancy material follow the app's Light / Dark / System, not the system's: a dark app on
// a light Mac otherwise draws light text over a light blur
import { ipcMain, nativeTheme } from 'electron';

export function registerNativeAppearanceIpc(): void {
	ipcMain.on('window:appearance', (_e, choice: unknown) => {
		if (choice === 'light' || choice === 'dark' || choice === 'system') nativeTheme.themeSource = choice;
	});
}
