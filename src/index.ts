import * as Sentry from '@sentry/electron';

Sentry.init({ dsn: 'https://1194b128453942ed9470d49a74c35992@o202389.ingest.sentry.io/1367048' });

function reportError(error: Error | string) {
    console.log(error);

    if (typeof error === 'string') {
        Sentry.captureMessage(error);
    } else {
        Sentry.captureException(error);
    }
}

import { spawn, exec, ChildProcess } from 'child_process';
import * as os from 'os';
import { promises as fs } from 'fs'
import * as net from 'net';
import * as path from 'path';
import { promisify } from 'util';
import * as querystring from 'querystring';
import { URL } from 'url';
import { app, BrowserWindow, shell, Menu, dialog, session } from 'electron';
import * as uuid from 'uuid/v4';
import * as yargs from 'yargs';
import * as semver from 'semver';
import * as rimraf from 'rimraf';
import * as windowStateKeeper from 'electron-window-state';
import { getSystemProxy } from 'os-proxy-config';

import registerContextMenu = require('electron-context-menu');
registerContextMenu({
    showSaveImageAs: true
});

import { reportStartupEvents } from './report-install-event';
import { menu } from './menu';
import { getDeferred, delay } from './util';

const rmRF = promisify(rimraf);

const packageJson = require('../package.json');

const isWindows = os.platform() === 'win32';

const DEV_MODE = process.env.HTK_DEV === 'true';
const APP_URL = process.env.APP_URL || 'https://app.httptoolkit.tech';
const AUTH_TOKEN = uuid();
const DESKTOP_VERSION = packageJson.version;
const BUNDLED_SERVER_VERSION = packageJson.config['httptoolkit-server-version'];
if (!semver.parse(BUNDLED_SERVER_VERSION)) {
    throw new Error("Package.json must specify an exact server version");
}

const APP_PATH = app.getAppPath();
const RESOURCES_PATH = APP_PATH.endsWith('app.asar')
    ? path.dirname(APP_PATH) // If we're bundled, resources are above the bundle
    : APP_PATH; // Otherwise everything is in the root of the app

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let windows: Electron.BrowserWindow[] = [];

let server: ChildProcess | null = null;

app.commandLine.appendSwitch('ignore-connections-limit', 'app.httptoolkit.tech');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('js-flags', '--expose-gc'); // Expose window.gc in the UI

const createWindow = () => {
    // Load the previous window state, falling back to defaults
    let windowState = windowStateKeeper({
        defaultWidth: 1366,
        defaultHeight: 768
    });

    const window = new BrowserWindow({
        title: 'HTTP Toolkit',
        backgroundColor: '#d8e2e6',

        minWidth: 1024,
        minHeight: 700,

        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,

        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            enableRemoteModule: false
        },

        show: false
    });
    windows.push(window);

    windowState.manage(window);

    window.loadURL(APP_URL + '?' + querystring.stringify({
        authToken: AUTH_TOKEN,
        desktopVersion: DESKTOP_VERSION
    }));

    window.on('ready-to-show', function () {
        window!.show();
        window!.focus();
    });

    window.on('closed', () => {
        const index = windows.indexOf(window);
        if (index > -1) {
            windows.splice(index, 1);
        }
    });
};

const amMainInstance = app.requestSingleInstanceLock();
if (!amMainInstance) {
    console.log('Not the main instance - quitting');
    app.quit();
} else {
    const args = yargs
        .option('with-forwarding', {
            type: 'string',
            hidden: true,
            description: "Preconfigure a forwarding address, for integration with other tools."
        })
        .version(DESKTOP_VERSION)
        .help()
        .argv;

    if (
        args['with-forwarding'] && (
            !args['with-forwarding'].includes('|') ||
            args['with-forwarding'].match(/'"\n/)
        )
    ) {
        console.error('Invalid --with-forwarding argument');
        process.exit(1); // Safe to hard exit - we haven't opened/started anything yet.
    }

    let serverKilled = false;
    app.on('will-quit', (event) => {
        if (server && !serverKilled) {
            serverKilled = true;
            try {
                if (isWindows) {
                    // Don't shutdown until we've tried to kill the server
                    event.preventDefault();

                    // Forcefully kill the pid (the cmd) and child processes
                    exec(`taskkill /pid ${server.pid} /T /F`, (error, stdout, stderr) => {
                        if (error) {
                            console.log(stdout);
                            console.log(stderr);
                            reportError(error);
                        }

                        // We've done our best - now shut down for real. Disable errors, otherwise
                        // we can receive reports for invisible errors during/just after exit.
                        app.quit();
                    });
                } else {
                    // Make sure we clean up the whole group (shell + node).
                    // https://azimi.me/2014/12/31/kill-child_process-node-js.html
                    process.kill(-server.pid!);
                }
            } catch (error) {
                console.log('Failed to kill server', error);
                reportError(error);
            }
        }
    });

    app.on('web-contents-created', (_event, contents) => {
        function injectValue(name: string, value: string) {
            // Set a variable globally, and self-postmessage it too (to ping
            // anybody who's explicitly waiting for it).
            contents.executeJavaScript(`
                window.${name} = '${value}';
                window.postMessage({ ${name}: window.${name} }, '*');
            `);
        }

        contents.on('dom-ready', () => {
            // Define & announce config values to the app.

            // Desktop version isn't used yet. Intended to allow us to detect
            // and prompt for updates in future if a certain desktop version
            // is required, and for error reporting context when things go wrong.
            injectValue('httpToolkitDesktopVersion', DESKTOP_VERSION);

            // Auth token is also injected into query string, but query string
            // gets replaced on first navigation (immediately), whilst global
            // vars like this are forever.
            injectValue('httpToolkitAuthToken', AUTH_TOKEN);

            if (args['with-forwarding']) injectValue('httpToolkitForwardingDefault', args['with-forwarding']);
        });

        // Redirect all navigations & new windows to the system browser
        contents.on('will-navigate', handleNavigation);
        contents.on('new-window', handleNavigation);

        contents.on('render-process-gone', (_event, details) => {
            if (details.reason === 'clean-exit') return;

            reportError(`Renderer gone: ${details.reason}`);
            showErrorAlert(
                "UI crashed",
                "The HTTP Toolkit UI stopped unexpected.\n\nPlease file an issue at github.com/httptoolkit/httptoolkit."
            );

            setImmediate(() => {
                contents.reload();
            });
        });
    });

    function handleNavigation(event: Electron.Event, navigationUrl: string) {
        const parsedUrl = new URL(navigationUrl);

        checkForUnsafeNavigation(parsedUrl);

        if (!isLocalNavigation(parsedUrl)) {
            event.preventDefault();
            handleExternalNavigation(parsedUrl);
        }
    }

    function checkForUnsafeNavigation(url: URL) {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            // This suggests an attempted XSS attack of some sort, report it:
            const error = new Error(`Attempt to open a dangerous non-HTTP url: ${url}`);
            throw error;
        }
    }

    function isLocalNavigation(url: URL) {
        return url.origin === APP_URL;
    }

    function handleExternalNavigation(url: URL) {
        shell.openExternal(url.toString())
            .catch((error) => {
                showErrorAlert(
                    "Failed to open URL",
                    `HTTP Toolkit could not open ${url.toString()} in your browser, because: ${error?.message ?? error ?? 'unknown error'}`
                );
                throw error;
            });
    }

    function showErrorAlert(title: string, body: string) {
        console.warn(`${title}: ${body}`);
        dialog.showErrorBox(title, body);
    }

    // On startup, we want to kill server directories if the bundled server version is newer. This ensures that
    // the desktop app can always guarantee the server is at least its bundled version, to automatically pick
    // up updates more quickly and avoid incompatibilities.
    async function cleanupOldServers() {
        // This mirrors the path logic from Oclif:
        // https://github.com/oclif/config/blob/master/src/config.ts +
        // https://github.com/oclif/plugin-update/blob/master/src/hooks/init.ts

        const homeDir = process.env.HOME ||
            (isWindows && (
                (
                    process.env.HOMEDRIVE &&
                    process.env.HOMEPATH &&
                    path.join(process.env.HOMEDRIVE!, process.env.HOMEPATH!)
                ) ||
                process.env.USERPROFILE
            )) ||
            os.homedir() ||
            os.tmpdir();

        const oclifDataPath = path.join(
            process.env.XDG_DATA_HOME ||
            (isWindows && process.env.LOCALAPPDATA) ||
            path.join(homeDir, '.local', 'share'),
            'httptoolkit-server'
        );

        const serverUpdatesPath = process.env.OCLIF_CLIENT_HOME ||
            path.join(oclifDataPath, 'client');

        const serverPaths = await fs.readdir(serverUpdatesPath)
            // Don't error if this path doesn't exist - that's normal at first
            .catch((e) => {
                if (e.code === 'ENOENT') {
                    return [] as string[];
                } else throw e;
            });

        if (serverPaths.some((filename) =>
            !semver.valid(filename.replace(/\.partial\.\d+$/, '')) &&
            filename !== 'bin' &&
            filename !== 'current' &&
            filename !== '.DS_Store' // Meaningless Mac folder metadata
        )) {
            // If the folder contains something other than the expected version folders, be careful.
            console.log(serverPaths);
            reportError(
                `Server path (${serverUpdatesPath}) contains unexpected content, ignoring`
            );
            return;
        }

        // If the bundled server is newer than all installed server versions, then
        // delete all the installed server versions entirely before we start.
        if (serverPaths.length && !serverPaths.some((serverPath) => {
            try {
                return semver.gt(serverPath, BUNDLED_SERVER_VERSION)
            } catch (e) {
                return false;
            }
        })) {
            console.log('All server versions installed are outdated, deleting');
            await rmRF(serverUpdatesPath);
        }
    }

    // When run *before* the server starts, this allows us to check whether the port is already in use,
    // so we can provide clear setup instructions and avoid confusing errors later.
    function checkServerPortAvailable(host: string, port: number): Promise<void> {
        const conn = net.connect({ host, port });

        return Promise.race([
            new Promise<void>((resolve, reject) => {
                // If we can already connect to the local port, then it's not available for our server:
                conn.on('connect', () =>
                    reject(new Error(`Port ${port} is already in use`))
                );
                // If we fail to connect to the port, it's probably available:
                conn.on('error', resolve);
            }),
            // After 100 ms with no connection, assume the port is available:
            delay(100)
        ])
        .finally(() => {
            conn.destroy();
        });
    }

    async function startServer(retries = 2) {
        const binName = isWindows ? 'httptoolkit-server.cmd' : 'httptoolkit-server';
        const serverBinPath = path.join(RESOURCES_PATH, 'httptoolkit-server', 'bin', binName);
        const serverBinCommand = isWindows ? `"${serverBinPath}"` : serverBinPath;

        server = spawn(serverBinCommand, ['start'], {
            windowsHide: true,
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: isWindows, // Required to spawn a .cmd script
            windowsVerbatimArguments: false, // Fixes quoting in windows shells
            detached: !isWindows, // Detach on Linux, so we can cleanly kill as a group
            env: Object.assign({}, process.env, {
                HTK_SERVER_TOKEN: AUTH_TOKEN,
                NODE_SKIP_PLATFORM_CHECK: '1',
                NODE_OPTIONS:
                    process.env.HTTPTOOLKIT_NODE_OPTIONS || // Allow manually configuring node options
                    "--max-http-header-size=102400" // By default, set max header size to 100KB
            })
        });

        // Both not null because we pass 'pipe' for args 2 & 3 above.
        const stdout = server.stdout!;
        const stderr = server.stderr!;

        stdout.pipe(process.stdout);
        stderr.pipe(process.stderr);

        server.stdout!.on('data', (data) => {
            Sentry.addBreadcrumb({ category: 'server-stdout', message: data.toString('utf8'), level: <any>'info' });
        });

        let lastError: string | undefined = undefined;
        stderr.on('data', (data) => {
            const errorOutput = data.toString('utf8');
            Sentry.addBreadcrumb({ category: 'server-stderr', message: errorOutput, level: <any>'warning' });

            // Remember the last '*Error:' line we saw.
            lastError = errorOutput
                .split('\n')
                .filter((line: string) => line.match(/^\w*Error:/))
                .slice(-1)[0];
        });

        const serverStartTime = Date.now();

        const serverShutdown: Promise<void> = new Promise<Error | number | null>((resolve) => {
            server!.once('error', resolve);
            server!.once('exit', resolve);
        }).then((errorOrCode) => {
            if (serverKilled) return;

            // The server should never shutdown unless the whole process is finished, so this is bad.
            const serverRunTime = Date.now() - serverStartTime;

            let error: Error;

            if (errorOrCode && typeof errorOrCode !== 'number') {
                error = errorOrCode;
            } else if (lastError) {
                error = new Error(`Server crashed with '${lastError}' (${errorOrCode})`);
            } else {
                error = new Error(`Server shutdown unexpectedly with code ${errorOrCode}`);
            }

            Sentry.addBreadcrumb({ category: 'server-exit', message: error.message, level: <any>'error', data: { serverRunTime } });
            reportError(error);

            showErrorAlert(
                'HTTP Toolkit hit an error',
                `${error.message}.\n\nPlease file an issue at github.com/httptoolkit/httptoolkit.`
            );

            // Retry limited times, but not for near-immediate failures.
            if (retries > 0 && serverRunTime > 5000) {
                // This will break the app, so refresh it
                windows.forEach(window => window.reload());
                return startServer(retries - 1);
            }

            // If we've run out of retries, throw (kill the app entirely)
            throw error;
        });

        return serverShutdown;
    }

    reportStartupEvents();

    // Use a promise to organize events around 'ready', and ensure they never
    // fire before, as Electron will refuse to do various things if they do.
    const appReady = getDeferred();
    app.on('ready', () => appReady.resolve());

    const portCheck = checkServerPortAvailable('127.0.0.1', 45457)
        .catch(async () => {
            if (DEV_MODE) return; // In full dev mode this is OK & expected
            await appReady.promise;

            showErrorAlert(
                "HTTP Toolkit could not start",
                "HTTP Toolkit's local management port (45457) is already in use.\n\n" +
                "Do you have another HTTP Toolkit process running somewhere?\n" +
                "Please close the other process using this port, and try again.\n\n" +
                "(Having trouble? File an issue at github.com/httptoolkit/httptoolkit)"
            );

            process.exit(2);
        });

    // Check we're happy using the default proxy settings: true if so, false if not.
    const proxyCheck = getSystemProxy()
        .then((proxyConfig) => {
            // If there's no proxy then the default settings are totally fine:
            if (!proxyConfig) return true;

            // If the proxy is local, don't use it (this probably means HTTP Toolkit itself is the
            // system proxy, which causes lots of problems - we avoid in that case).
            const proxyHostname = new URL(proxyConfig.proxyUrl).hostname;
            if (proxyHostname === 'localhost' || proxyHostname.startsWith('127.0.0')) return false;

            // Otherwise: we have a valid remote proxy server. We should use it - it might be
            // required for us to get any connectivity at all.
            return true;
        });

    proxyCheck.then((shouldUseProxy) => {
        if (!shouldUseProxy) {
            console.warn("Ignoring localhost system proxy setting");

            // If the proxy is unsuitable (there is none, or its localhost and so might be a loop) then
            // we drop all proxy config and try to connect to everything directly instead.

            // This tries to avoid passing bad config through to the server. Nice to do but not critical,
            // since upstream (i.e. everything except updates & error reports) is configured by the UI.
            ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY'].forEach((v) => delete process.env[v]);

            if (app.isReady()) {
                // If the app has already started at this point, things get more messy.

                // First, we change the default session to avoid the proxy:
                session.defaultSession.setProxy({ mode: 'direct' });

                // Then we have to reset any existing windows, so that they avoid the proxy. They're
                // probably broken anyway at this stage.
                windows.forEach(window => {
                    const { session } = window.webContents;
                    session.closeAllConnections()
                    session.setProxy({ mode: 'direct' });
                    window.reload();
                });
            } else {
                // If the app hasn't started yet it's easy: we disable Chromium's proxy detection entirely
                app.commandLine.appendSwitch('no-proxy-server');
            }

        }
        // Otherwise we just let Electron use the defaults - no problem at all.
    });

    Promise.all([
        cleanupOldServers().catch(console.log),
        portCheck
    ]).then(() =>
        startServer()
    ).catch((err) => {
        console.error('Failed to start server, exiting.', err);

        // Hide immediately, shutdown entirely after a brief pause for Sentry
        windows.forEach(window => window.hide());
        setTimeout(() => process.exit(3), 500);
    });

    Promise.all([appReady.promise, portCheck]).then(() => {
        Menu.setApplicationMenu(menu);
        createWindow();
    });

    // We use a single process instance to manage the server, but we
    // do allow multiple windows.
    app.on('second-instance', () =>
        appReady.promise.then(() => createWindow())
    );

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (windows.length === 0) {
            // Wait until the ready event - it's possible that this can fire
            // before the app is ready (not sure how) in which case things break!
            appReady.promise.then(() => createWindow());
        }
    });

    app.on('window-all-closed', () => {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}