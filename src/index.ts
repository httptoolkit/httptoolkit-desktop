const DEV_MODE = process.env.HTK_DEV === 'true';

// Set up error handling before everything else:
import { logError, addBreadcrumb } from './errors';

import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import { promises as fs, createWriteStream, WriteStream } from 'fs'
import * as net from 'net';
import * as path from 'path';
import * as crypto from 'crypto';
import { promisify } from 'util';
import * as querystring from 'querystring';
import { URL } from 'url';
import { app, BrowserWindow, shell, Menu, dialog, session, ipcMain } from 'electron';
import * as yargs from 'yargs';
import * as semver from 'semver';
import * as rimraf from 'rimraf';
const rmRF = promisify(rimraf);

import * as windowStateKeeper from 'electron-window-state';
import { getSystemProxy } from 'os-proxy-config';
import registerContextMenu = require('electron-context-menu');

import { getDeferred, delay } from './util';
import { getMenu, shouldAutoHideMenu } from './menu';
import { ContextMenuDefinition, openContextMenu } from './context-menu';
import { stopServer } from './stop-server';

const packageJson = require('../package.json');

const isWindows = os.platform() === 'win32';

const APP_URL = process.env.APP_URL || 'https://app.httptoolkit.tech';
const AUTH_TOKEN = crypto.randomBytes(20).toString('base64url');
const DESKTOP_VERSION = packageJson.version;
const BUNDLED_SERVER_VERSION = packageJson.config['httptoolkit-server-version'];
if (!semver.parse(BUNDLED_SERVER_VERSION)) {
    throw new Error("Package.json must specify an exact server version");
}

const APP_PATH = app.getAppPath();
const RESOURCES_PATH = APP_PATH.endsWith('app.asar')
    ? path.dirname(APP_PATH) // If we're bundled, resources are above the bundle
    : APP_PATH; // Otherwise everything is in the root of the app
const LOGS_PATH = app.getPath('logs');
const LAST_RUN_LOG_PATH = path.join(LOGS_PATH, 'last-run.log');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let windows: Electron.BrowserWindow[] = [];

let server: ChildProcess | null = null;

app.commandLine.appendSwitch('ignore-connections-limit', 'app.httptoolkit.tech');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('js-flags', '--expose-gc'); // Expose window.gc in the UI

const createWindow = (logStream: WriteStream) => {
    // Load the previous window state, falling back to defaults
    let windowState = windowStateKeeper({
        defaultWidth: 1366,
        defaultHeight: 768
    });

    const window = new BrowserWindow({
        title: 'HTTP Toolkit',
        backgroundColor: '#d8e2e6',

        minWidth: 700,
        minHeight: 600,

        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,

        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },

        show: false
    });

    if (shouldAutoHideMenu()) {
        window.setAutoHideMenuBar(true);
        window.setMenuBarVisibility(false);
    }

    windows.push(window);
    windowState.manage(window);

    // Stream renderer console output directly into our log file:
    window.webContents.on('console-message', (_event, level, message) => {
        const levelName = [
            'VERBOSE',
            'INFO',
            'WARN',
            'ERROR'
        ][level];
        logStream.write(`${levelName}: ${message}\n`);
    });

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
    const logStream = createWriteStream(LAST_RUN_LOG_PATH);
    logStream.write(`--- Launching HTTP Toolkit desktop v${DESKTOP_VERSION} ---\n`);

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
    app.on('will-quit', async (event) => {
        if (server && !serverKilled) {
            // Don't shutdown until we've tried to kill the server
            event.preventDefault();

            serverKilled = true;

            try {
                await stopServer(server, AUTH_TOKEN);
            } catch (error) {
                console.log('Failed to kill server', error);
                logError(error);
            } finally {
                // We've done our best - now shut down for real.
                app.quit();
            }
        }
    });

    app.on('quit', () => {
        logStream.close(); // Explicitly close the logstream, to flush everything to disk.
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
        contents.on('will-navigate', (event: Electron.Event, navigationUrl: string) => {
            const parsedUrl = new URL(navigationUrl);

            checkForUnsafeNavigation(parsedUrl);
            if (!isLocalNavigation(parsedUrl)) {
                event.preventDefault();
                handleExternalNavigation(parsedUrl);
            }
        });
        contents.setWindowOpenHandler((openDetails) => {
            const parsedUrl = new URL(openDetails.url);

            checkForUnsafeNavigation(parsedUrl);
            if (!isLocalNavigation(parsedUrl)) {
                handleExternalNavigation(parsedUrl);
                return { action: 'deny' };
            } else {
                return { action: 'allow' };
            }
        });

        contents.on('render-process-gone', (_event, details) => {
            if (details.reason === 'clean-exit') return;

            logError(`Renderer gone: ${details.reason}`);
            showErrorAlert(
                "UI crashed",
                "The HTTP Toolkit UI stopped unexpected.\n\nPlease file an issue at github.com/httptoolkit/httptoolkit."
            );

            setImmediate(() => {
                contents.reload();
            });
        });

        contents.on('did-fail-load', (
            _event,
            code,
            description,
            url,
            isMainFrame
        ) => {
            if (!isMainFrame) return; // Just in case

            const { protocol, host, pathname } = new URL(url);
            const baseURL = `${protocol}//${host}${pathname}`;

            showErrorAlert(
                "UI load failed",
                `The HTTP Toolkit UI could not be loaded from\n${baseURL}.` +
                "\n\n" +
                `${description} (${code})`
            );

            setTimeout(() => {
                contents.reload();
            }, 2000);
        });
    });

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
        logStream.write(`ALERT: ${title}: ${body}\n`);
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
            logError(
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

        const envVars = {
            ...process.env,

            HTK_SERVER_TOKEN: AUTH_TOKEN,
            NODE_SKIP_PLATFORM_CHECK: '1',
            OPENSSL_CONF: undefined, // Not relevant to us, and if set this can crash Node.js

            NODE_OPTIONS:
                process.env.HTTPTOOLKIT_NODE_OPTIONS || // Allow manually configuring node options
                [
                    "--max-http-header-size=102400", // By default, set max header size to 100KB
                    "--insecure-http-parser" // Allow invalid HTTP, e.g. header values - we'd rather be invisible than strict
                ].join(' ')
        }

        server = spawn(serverBinCommand, ['start'], {
            windowsHide: true,
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: isWindows, // Required to spawn a .cmd script
            windowsVerbatimArguments: false, // Fixes quoting in windows shells
            detached: !isWindows, // Detach on Linux, so we can cleanly kill as a group
            env: envVars
        });

        // Both not null because we pass 'pipe' for args 2 & 3 above.
        const serverStdout = server.stdout!;
        const serverStderr = server.stderr!;

        serverStdout.pipe(process.stdout);
        serverStderr.pipe(process.stderr);
        serverStdout.pipe(logStream);
        serverStderr.pipe(logStream);

        server.stdout!.on('data', (data) => {
            addBreadcrumb({ category: 'server-stdout', message: data.toString('utf8'), level: <any>'info' });
        });

        let lastError: string | undefined = undefined;
        serverStderr.on('data', (data) => {
            const errorOutput = data.toString('utf8');
            addBreadcrumb({ category: 'server-stderr', message: errorOutput, level: <any>'warning' });

            // Remember the last '*Error:' line we saw.
            lastError = errorOutput
                .split('\n')
                .filter((line: string) => line.match(/^\s*Error:/i))
                .slice(-1)[0]?.trim() || lastError;
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

            addBreadcrumb({
                category: 'server-exit', message: error.message, level: <any>'error', data: { serverRunTime }
            });
            logError(error, ['server-exit', error.message, (error as any).code?.toString() || '']);

            showErrorAlert(
                'HTTP Toolkit hit an error',
                `${error.message}.\n\n` +
                `See ${LAST_RUN_LOG_PATH} for more details.\n\n` +
                `Please file an issue at github.com/httptoolkit/httptoolkit.`
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

    // Check we're happy using the default proxy settings
    getSystemProxy()
        .then((proxyConfig) => {
            let shouldDisableProxy = false;

            if (proxyConfig) {
                // If the proxy is local, we don't use it (this probably means HTTP Toolkit itself is the
                // system proxy, which causes lots of problems - we avoid in that case).
                const proxyHostname = new URL(proxyConfig.proxyUrl).hostname;
                if (proxyHostname === 'localhost' || proxyHostname.startsWith('127.0.0')) {
                    shouldDisableProxy = true;
                }

                // If there's no proxy config, if we can't easily parse it, or if it's not localhost
                // then we use it as normal - it might be required for connectivity.
            }

            if (shouldDisableProxy) {
                console.warn("Ignoring localhost system proxy setting");

                // If the proxy is unsuitable (there is none, or its localhost and so might be a loop) then
                // we drop all proxy config and try to connect to everything directly instead.

                // This tries to avoid passing bad config through to the server. Nice to do but not critical,
                // since upstream (i.e. everything except updates & error reports) is checked & configured by the UI.
                ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY'].forEach((v) => delete process.env[v]);

                if (!app.isReady()) {
                    // If the app hasn't started yet it's easy: we disable Chromium's proxy detection entirely
                    app.commandLine.appendSwitch('no-proxy-server');
                } else {
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
                }
            }
            // Otherwise we just let Electron use the defaults - no problem at all.
        })
        .catch((e) => {
            logError(e);
            return undefined;
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
        Menu.setApplicationMenu(getMenu(windows));
        createWindow(logStream);
    });

    // We use a single process instance to manage the server, but we
    // do allow multiple windows.
    app.on('second-instance', () =>
        appReady.promise.then(() => createWindow(logStream))
    );

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (windows.length === 0) {
            // Wait until the ready event - it's possible that this can fire
            // before the app is ready (not sure how) in which case things break!
            appReady.promise.then(() => createWindow(logStream));
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

ipcMain.handle('select-application', () => {
    return dialog.showOpenDialogSync({
        properties:
        process.platform === 'darwin'
            ? ['openFile', 'openDirectory', 'treatPackageAsDirectory']
            : ['openFile'],
    })?.[0];
});

// Enable the default context menu
registerContextMenu({
    showSaveImageAs: true,
    showSelectAll: false // Weird (does web-style select-all-text), skip it
});

// Enable custom context menus, for special cases where the UI wants to define the options available
ipcMain.handle('open-context-menu', (_event: {}, options: ContextMenuDefinition) =>
    openContextMenu(options)
);

ipcMain.handle('get-desktop-version', () => DESKTOP_VERSION);
ipcMain.handle('get-server-auth-token', () => AUTH_TOKEN);