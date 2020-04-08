import * as Sentry from '@sentry/electron';

Sentry.init({ dsn: 'https://1194b128453942ed9470d49a74c35992@sentry.io/1367048' });

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
import * as path from 'path';
import { promisify } from 'util';
import * as querystring from 'querystring';
import { app, BrowserWindow, shell, Menu, dialog } from 'electron';
import * as uuid from 'uuid/v4';
import * as yargs from 'yargs';
import * as semver from 'semver';
import * as rimraf from 'rimraf';
import * as windowStateKeeper from 'electron-window-state';

import registerContextMenu = require('electron-context-menu');
registerContextMenu({
    showSaveImageAs: true
});

import { reportStartupEvents } from './report-install-event';
import { menu } from './menu';

const rmRF = promisify(rimraf);

const packageJson = require('../package.json');
const packageJsonLock = require('../package-lock.json');

const isWindows = os.platform() === 'win32';

const APP_URL = process.env.APP_URL || 'https://app.httptoolkit.tech';
const AUTH_TOKEN = uuid();
const DESKTOP_VERSION = packageJson.version;
const BUNDLED_SERVER_VERSION = packageJsonLock.dependencies['httptoolkit-server'].version;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let windows: Electron.BrowserWindow[] = [];

let server: ChildProcess | null = null;

app.commandLine.appendSwitch('ignore-connections-limit', 'app.httptoolkit.tech');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const createWindow = () => {
    // Load the previous window state, falling back to defaults
    let windowState = windowStateKeeper({
        defaultWidth: 1366,
        defaultHeight: 768
    });

    const window = new BrowserWindow({
        title: 'HTTP Toolkit',
        icon: path.join(__dirname, 'src', 'icon.png'),
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

function disableEventReporting() {
    Sentry.getCurrentHub().getClient().getOptions().enabled = false;
}

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

    app.on('ready', () => {
        Menu.setApplicationMenu(menu);
    });

    app.on('window-all-closed', () => {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

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
                        process.nextTick(disableEventReporting);
                    });
                } else {
                    // Make sure we clean up the whole group (shell + node).
                    // https://azimi.me/2014/12/31/kill-child_process-node-js.html
                    process.kill(-server.pid);
                    process.nextTick(disableEventReporting);
                }
            } catch (error) {
                console.log('Failed to kill server', error);
                reportError(error);
            }
        }
    });

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (windows.length === 0) {
            createWindow();
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
        contents.on('will-navigate', (event, navigationUrl) => {
            const parsedUrl = new URL(navigationUrl);

            if (parsedUrl.origin !== APP_URL) {
                event.preventDefault();
                shell.openExternal(navigationUrl);
            }
        });

        contents.on('new-window', (event, navigationUrl) => {
            const parsedUrl = new URL(navigationUrl);

            if (parsedUrl.origin !== APP_URL) {
                event.preventDefault();
                shell.openExternal(navigationUrl);
            }
        });
    });

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

        const serverPaths = await fs.readdir(serverUpdatesPath);

        if (serverPaths.some((filename) =>
            !semver.valid(filename.replace(/\.partial\.\d+$/, '')) &&
            filename !== 'bin' &&
            filename !== 'current'
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
        if (!serverPaths.some((serverPath) => {
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

    async function startServer(retries = 2) {
        const binName = isWindows ? 'httptoolkit-server.cmd' : 'httptoolkit-server';
        const serverBinPath = path.join(__dirname, '..', 'httptoolkit-server', 'bin', binName);
        const serverBinCommand = isWindows ? `"${serverBinPath}"` : serverBinPath;

        server = spawn(serverBinCommand, ['start', '--token', AUTH_TOKEN], {
            windowsHide: true,
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: isWindows, // Required to spawn a .cmd script
            windowsVerbatimArguments: false, // Fixes quoting in windows shells
            detached: !isWindows, // Detach on Linux, so we can cleanly kill as a group
            env: Object.assign({}, process.env, {
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
                `${error.message}.\n\nPlease file an issue at github.com/httptoolkit/feedback.`
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

    if (require('electron-squirrel-startup')) {
        // We've been opened as part of a Windows install.
        // squirrel-startup handles all the hard work, we just need to not do anything.

        // Brief delay before quitting, so our analytics register
        setTimeout(() => app.quit(), 500);
    } else {
        cleanupOldServers().catch(console.log)
        .then(() => startServer())
        .catch((err) => {
            console.error('Failed to start server, exiting.', err);

            // Hide immediately, shutdown entirely after a brief pause for Sentry
            windows.forEach(window => window.hide());
            setTimeout(() => process.exit(1), 500);
        });

        app.on('ready', () => createWindow());
        // We use a single process instance to manage the server, but we
        // do allow multiple windows.
        app.on('second-instance', () => createWindow());
    }
}