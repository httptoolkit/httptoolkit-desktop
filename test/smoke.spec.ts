import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

async function launchApp(extraArgs: string[] = [], extraEnv: Record<string, string> = {}) {
    // On Linux ARM64 CI, sandboxing doesn't work, so we have to skip it.
    // [DIAG] HTK_DIAG_NO_SANDBOX=true forces --no-sandbox on any platform, so we can run the decisive
    // "Experiment A": make x64 CI behave like arm64 (no sandbox) and see if it then fails too.
    const useNoSandbox = process.env.HTK_DIAG_NO_SANDBOX === 'true' ||
        !!(process.env.CI && process.platform === 'linux' && process.arch === 'arm64');
    console.log(`[DIAG][test] launch: platform=${process.platform} arch=${process.arch} useNoSandbox=${useNoSandbox}`);

    const app = await electron.launch({
        cwd: path.join(import.meta.dirname, '..'),
        args: [
            '.',
            ...extraArgs,
            ...(useNoSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])
        ],
        timeout: 20000,
        env: {
            ...process.env,
            'HTTPTOOLKIT_SERVER_DISABLE_AUTOUPDATE': '1',
            ...extraEnv
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
    // [DIAG] Generous timeout so diagnostics always get a chance to print before the test ends.
    test.setTimeout(120_000);

    const electronApp = await launchApp();
    const window = await electronApp.firstWindow();

    // [DIAG] Capture renderer-side signals directly via Playwright. requestfailed is the key one:
    // if the UI can't reach the local server, we'll see failed requests to 127.0.0.1:<serverPort>.
    window.on('console', (msg) => console.log(`[DIAG][page console:${msg.type()}]`, msg.text()));
    window.on('pageerror', (err) => console.log('[DIAG][page pageerror]', err.message));
    window.on('crash', () => console.log('[DIAG][page crash]'));
    window.on('requestfailed', (req) =>
        console.log('[DIAG][page requestfailed]', req.method(), req.url(), '::', req.failure()?.errorText));

    // [DIAG] Wait for the connected-UI heading, but never throw here - we want to dump diagnostics
    // regardless of pass/fail so the CI log explains what happened.
    let headingVisible = false;
    try {
        await window.locator('h1:has-text("Intercept HTTP")')
            .waitFor({ state: 'visible', timeout: 60_000 });
        headingVisible = true;
    } catch (e) {
        console.log('[DIAG][test] heading never became visible:', (e as Error).message);
    }

    // [DIAG] Dump what the UI actually sees from the desktop API + page state. This directly tests
    // whether the auth token / server port made it through additionalArguments into the renderer.
    try {
        const state = await window.evaluate(() => {
            const api = (window as any).desktopApi;
            return {
                href: window.location.href,
                title: document.title,
                desktopApiPresent: typeof api !== 'undefined',
                desktopVersion: api?.getDesktopVersion?.(),
                authTokenPresent: !!api?.getServerAuthToken?.(),
                serverPort: api?.getServerPort?.(),
                mockttpPort: api?.getMockttpPort?.(),
                bodyTextSnippet: (document.body?.innerText || '').slice(0, 500),
                htmlLength: document.documentElement?.outerHTML?.length ?? 0
            };
        });
        console.log('[DIAG][test] page state:', JSON.stringify(state, null, 2));
    } catch (e) {
        console.log('[DIAG][test] failed to evaluate page state:', (e as Error).message);
    }

    await electronApp.close();

    // Real assertions still run, so the test still fails on regression.
    expect(headingVisible).toBe(true);
});
