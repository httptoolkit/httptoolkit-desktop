import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

test('app launches and loads UI from server', async () => {
    const electronApp = await electron.launch({
        cwd: path.join(import.meta.dirname, '..'),
        args: ['.'],
        timeout: 60000
    });

    const window = await electronApp.firstWindow();

    await expect(window.locator('h1:has-text("Intercept HTTP")')).toBeVisible({ timeout: 60000 });

    await electronApp.close();
});
