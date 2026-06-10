import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

async function launchApp(extraArgs: string[] = [], extraEnv: Record<string, string> = {}) {
    // On Linux ARM64 CI, sandboxing doesn't work, so we have to skip it.
    // [DIAG] HTK_DIAG_NO_SANDBOX=true forces --no-sandbox on any platform, so we can run the decisive
    // "Experiment A": make x64 CI behave like arm64 (no sandbox) and see if it then fails too.
    const useNoSandbox = process.env.HTK_DIAG_NO_SANDBOX === 'true' ||
        !!(process.env.CI && process.platform === 'linux' && process.arch === 'arm64');
    // [DIAG] Experiment: HTK_DIAG_DISABLE_GPU=true skips GPU init (which fails & falls back to software
    // on the arm64 runner) - to A/B whether it cuts the ~14s-to-app-ready + render time.
    const disableGpu = process.env.HTK_DIAG_DISABLE_GPU === 'true';
    console.log(`[DIAG][test] launch: platform=${process.platform} arch=${process.arch} useNoSandbox=${useNoSandbox} disableGpu=${disableGpu}`);

    const app = await electron.launch({
        cwd: path.join(import.meta.dirname, '..'),
        args: [
            '.',
            ...extraArgs,
            ...(useNoSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
            ...(disableGpu ? ['--disable-gpu', '--disable-gpu-compositing'] : [])
        ],
        // [DIAG] Raised from 20s: on slow arm64 runs app 'ready' can exceed 20s, so electron.launch
        // was aborting *before* our stdout handler attached - hiding the real app-ready time. With a
        // larger budget, slow-but-progressing launches complete and emit the full [DIAG][T+...] timeline.
        timeout: 60000,
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

    // [DIAG] t0 for the test side, to time launch -> firstWindow -> heading-visible.
    const tStart = Date.now();
    const since = () => Date.now() - tStart;

    const electronApp = await launchApp();
    console.log(`[DIAG][test] launchApp returned @ ${since()}ms`);
    const window = await electronApp.firstWindow();
    console.log(`[DIAG][test] firstWindow @ ${since()}ms`);

    // [DIAG] Capture renderer-side signals directly via Playwright. requestfailed is the key one:
    // if the UI can't reach the local server, we'll see failed requests to 127.0.0.1:<serverPort>.
    window.on('console', (msg) => console.log(`[DIAG][page console:${msg.type()}]`, msg.text()));
    window.on('pageerror', (err) => console.log('[DIAG][page pageerror]', err.message));
    window.on('crash', () => console.log('[DIAG][page crash]'));
    window.on('requestfailed', (req) =>
        console.log(`[DIAG][page requestfailed @ ${since()}ms]`, req.method(), req.url(), '::', req.failure()?.errorText));

    // [DIAG] Time the first request the UI makes to the local server (127.0.0.1 / localhost), and the
    // first response from it. The gap from "page loaded" to "first local request" is UI boot time;
    // the gap from there to the heading is connect+render time.
    let loggedFirstLocalReq = false;
    let loggedFirstLocalRes = false;
    const isLocal = (url: string) => url.includes('127.0.0.1') || url.includes('localhost');
    window.on('request', (req) => {
        if (isLocal(req.url()) && !loggedFirstLocalReq) {
            loggedFirstLocalReq = true;
            console.log(`[DIAG][test] first local-server request @ ${since()}ms: ${req.method()} ${req.url()}`);
        }
    });
    window.on('response', (res) => {
        if (isLocal(res.url()) && !loggedFirstLocalRes) {
            loggedFirstLocalRes = true;
            console.log(`[DIAG][test] first local-server response @ ${since()}ms: ${res.status()} ${res.url()}`);
        }
    });

    // [DIAG] Wait for the connected-UI heading, but never throw here - we want to dump diagnostics
    // regardless of pass/fail so the CI log explains what happened.
    let headingVisible = false;
    try {
        await window.locator('h1:has-text("Intercept HTTP")')
            .waitFor({ state: 'visible', timeout: 60_000 });
        headingVisible = true;
        console.log(`[DIAG][test] heading visible @ ${since()}ms`);
    } catch (e) {
        console.log(`[DIAG][test] heading never became visible (@ ${since()}ms):`, (e as Error).message);
    }

    // [DIAG] Dump what the UI actually sees from the desktop API + page state. This directly tests
    // whether the auth token / server port made it through additionalArguments into the renderer.
    try {
        const state = await window.evaluate(() => {
            const api = (window as any).desktopApi;

            // Navigation timing: when the main document loaded (network + parse), relative to nav start.
            const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
            const navTiming = nav ? {
                responseEnd: Math.round(nav.responseEnd),
                domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
                domComplete: Math.round(nav.domComplete),
                loadEventEnd: Math.round(nav.loadEventEnd)
            } : null;

            // Resource timing for requests to the local server (server connect cost) and the heaviest
            // resources overall (to spot a slow CDN bundle fetch).
            const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            const localResources = resources
                .filter(r => r.name.includes('127.0.0.1') || r.name.includes('localhost'))
                .map(r => ({ name: r.name, start: Math.round(r.startTime), dur: Math.round(r.duration) }));
            const slowest = resources
                .slice()
                .sort((a, b) => b.duration - a.duration)
                .slice(0, 8)
                .map(r => ({ name: r.name.slice(0, 120), start: Math.round(r.startTime), dur: Math.round(r.duration) }));

            const sw = (navigator as any).serviceWorker;

            return {
                href: window.location.href,
                title: document.title,
                desktopApiPresent: typeof api !== 'undefined',
                desktopVersion: api?.getDesktopVersion?.(),
                authTokenPresent: !!api?.getServerAuthToken?.(),
                serverPort: api?.getServerPort?.(),
                mockttpPort: api?.getMockttpPort?.(),
                serviceWorkerControlled: !!sw?.controller,
                navTiming,
                localResources,
                slowestResources: slowest,
                resourceCount: resources.length,
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
