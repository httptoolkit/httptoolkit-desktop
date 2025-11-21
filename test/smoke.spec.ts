import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

async function launchApp() {
    const app = await electron.launch({
        cwd: path.join(import.meta.dirname, '..'),
        args: [
            '.',
            // On Linux ARM64 CI, sandboxing doesn't work, so we have to skip it:
            ...(process.env.CI && process.platform === 'linux' && process.arch === 'arm64' ?
                [
                '--no-sandbox',
                '--disable-setuid-sandbox'
                ] : []
            )
        ],
        timeout: 10000,
        env: {
            ...process.env,
            // Disable auto-update during tests
            'HTTPTOOLKIT_SERVER_DISABLE_AUTOUPDATE': '1'
        }
    });

    app.process().stdout?.on('data', (data) => {
        console.log('[stdout]', data.toString().trim());
    });
    app.process().stderr?.on('data', (data) => {
        console.error('[stderr]', data.toString().trim());
    });

    return app;
}

test('app launches and loads UI from server', async () => {
    const electronApp = await launchApp();
    const window = await electronApp.firstWindow();

    // Has the UI loaded & initialized (connected to the server) successfully?
    await expect(window.locator('h1:has-text("Intercept HTTP")')).toBeVisible({ timeout: 15000 });

    // Has the preload injected the desktop APIs successfully?
    await expect(window.evaluate(() => typeof (window as any).desktopApi !== 'undefined')).resolves.toBe(true);

    await electronApp.close();
});
