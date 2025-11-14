import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

test('app launches and loads UI from server', async () => {
    const electronApp = await electron.launch({
        cwd: path.join(import.meta.dirname, '..'),
        args: ['.'],
        timeout: 60000
    });

    electronApp.process().stdout?.on('data', (data) => {
        console.log('[stdout]', data.toString());
    });
    electronApp.process().stderr?.on('data', (data) => {
        console.error('[stderr]', data.toString());
    });

    const window = await electronApp.firstWindow();

    await expect(window.evaluate(() => typeof (window as any).desktopApi !== 'undefined')).resolves.toBe(true);

    await expect(window.locator('h1:has-text("Intercept HTTP")')).toBeVisible({ timeout: 60000 });

    await electronApp.close();
});
