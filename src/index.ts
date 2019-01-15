import * as Sentry from '@sentry/electron';
Sentry.init({ dsn: 'https://1194b128453942ed9470d49a74c35992@sentry.io/1367048' });

function reportError(error: Error | string) {
    if (typeof error === 'string') {
        Sentry.captureMessage(error);
    } else {
        Sentry.captureException(error);
    }
}

import { spawn, exec, ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { app, BrowserWindow, shell, Menu } from 'electron';

import * as windowStateKeeper from 'electron-window-state';

import registerContextMenu = require('electron-context-menu');
registerContextMenu({
    showSaveImageAs: true
});

import { menu } from './menu';

const packageJson = require('../package.json');

const isWindows = os.platform() === 'win32';

const APP_URL = process.env.APP_URL || 'https://app.httptoolkit.tech';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: Electron.BrowserWindow | null = null;

let server: ChildProcess | null = null;

app.commandLine.appendSwitch('ignore-connections-limit', 'app.httptoolkit.tech');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const createWindow = () => {
    // Load the previous window state, falling back to defaults
    let mainWindowState = windowStateKeeper({
        defaultWidth: 1366,
        defaultHeight: 768
    });

    mainWindow = new BrowserWindow({
        title: 'HTTP Toolkit',
        icon: path.join(__dirname, 'src', 'icon.png'),
        backgroundColor: '#d8e2e6',

        minWidth: 1024,
        minHeight: 700,

        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,

        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        },

        show: false
    });

    mainWindowState.manage(mainWindow);

    mainWindow.loadURL(APP_URL);

    mainWindow.on('ready-to-show', function() {
        mainWindow!.show();
        mainWindow!.focus();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
};

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

                    // We've done our best - now shut down for real
                    app.quit();
                });
            } else {
                // Make sure we clean up the whole group (shell + node).
                // https://azimi.me/2014/12/31/kill-child_process-node-js.html
                process.kill(-server.pid);
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
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('web-contents-created', (_event, contents) => {
    contents.on('dom-ready', () => {
        // Define & announce the desktop shell version to the app
        // Not used now, intended to allow us to detect and prompt for updates
        // in future, if a certain desktop shell version is required.
        contents.executeJavaScript(`
            window.httpToolkitDesktopVersion = '${packageJson.version}';
            window.postMessage({ httpToolkitDesktopVersion: window.httpToolkitDesktopVersion }, '*');
        `);
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

async function startServer(retries = 2) {
    const binName = isWindows ? 'httptoolkit-server.cmd' : 'httptoolkit-server';
    const serverBinPath = path.join(__dirname, '..', 'httptoolkit-server', 'bin', binName);

    server = spawn(serverBinPath, ['start'], {
        windowsHide: true,
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: isWindows,
        detached: !isWindows
    });

    server.stdout.pipe(process.stdout);
    server.stderr.pipe(process.stderr);

    server.stdout.on('data', (data) => {
        Sentry.addBreadcrumb({ category: 'server-stdout', message: data.toString('utf8'), level: <any> 'info' });
    });

    server.stderr.on('data', (data) => {
        Sentry.addBreadcrumb({ category: 'server-stderr', message: data.toString('utf8'), level: <any> 'warning' });
    });

    const serverShutdown: Promise<void> = new Promise<Error | number | null>((resolve) => {
        server!.once('error', resolve);
        server!.once('exit', resolve);
    }).then((errorOrCode) => {
        if (serverKilled) return;

        // The server should never shutdown unless the whole process is finished, so this is bad.

        const error = errorOrCode && typeof errorOrCode !== 'number' ?
            errorOrCode : new Error(`Server shutdown unexpectedly with code ${errorOrCode}.`);

        if (retries > 0) {
            Sentry.addBreadcrumb({ category: 'server-exit', message: error.message, level: <any> 'error' });

            // This will break the app, so refresh it
            if (mainWindow) mainWindow.reload();
            return startServer(retries - 1);
        }

        throw error;
    });

    return serverShutdown;
}

if (require('electron-squirrel-startup')) {
    // We've been opened as part of a Windows install.
    // squirrel-startup handles all the hard work, we just need to not do anything.
    app.quit();
} else {
    startServer().catch((err) => {
        reportError(err);
        console.error('Failed to start server, exiting.', err);

        // Hide immediately, shutdown entirely after a brief pause for Sentry
        if (mainWindow) mainWindow.hide();
        setTimeout(() => process.exit(1), 500);
    });

    app.on('ready', () => createWindow());
}