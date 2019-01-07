import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { app, BrowserWindow, shell, Menu } from 'electron';

import * as registerContextMenu from 'electron-context-menu';
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
    mainWindow = new BrowserWindow({
        title: 'HTTP Toolkit',
        icon: path.join(__dirname, 'src', 'icon.png'),
        backgroundColor: '#d8e2e6',

        width: 1366,
        height: 768,
        minWidth: 1024,
        minHeight: 700,

        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        },

        show: false
    });

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

app.on('quit', () => {
    if (server) {
        if (!isWindows) {
            // On windows, children die automatically.
            // Elsewhere, we have to make sure we clean up the whole group.
            // https://azimi.me/2014/12/31/kill-child_process-node-js.html
            try {
                process.kill(-server.pid);
            } catch (e) { }
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

async function startServer() {
    const binName = isWindows ? 'httptoolkit-server.cmd' : 'httptoolkit-server';
    const serverBinPath = path.join(__dirname, '..', 'httptoolkit-server', 'bin', binName);

    server = spawn(serverBinPath, ['start'], {
        windowsHide: true,
        stdio: 'inherit',
        shell: isWindows,
        detached: !isWindows
    });

    const serverShutdown = new Promise((_resolve, reject) => {
        // The server should never shutdown unless the whole process is finished.
        server!.on('close', reject);
    });

    // Wait briefly, so we can fail hard if the server doesn't start somehow.
    return Promise.race([
        serverShutdown,
        new Promise((resolve) => setTimeout(resolve, 500))
    ]);
}

if (require('electron-squirrel-startup')) {
    // We've been opened as part of a Windows install.
    // squirrel-startup handles all the hard work, we just need to not do anything.
    app.quit();
} else {
    Promise.all([
        startServer(),
        new Promise((resolve) => app.on('ready', resolve))
    ]).then(() => createWindow());
}