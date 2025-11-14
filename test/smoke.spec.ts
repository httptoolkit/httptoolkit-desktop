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
    console.log('saw desktopApi');

    await expect(window.locator('h1:has-text("Intercept HTTP")')).toBeVisible({ timeout: 60000 });
    console.log('saw title');

    if (process.env.CI) {
        await Promise.race([
            electronApp.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('App failed to close within 5 seconds')), 5000))
        ]);
    } else {
        await electronApp.close();
    }
    console.log('closed app');
});
