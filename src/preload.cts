import * as electron from 'electron';
const {
    contextBridge,
    ipcRenderer: { invoke: ipcInvoke }
} = electron;

import type { ContextMenuDefinition } from './context-menu.ts';

// These are technically asynchronous, but they're so fast that
// they're effectively sychronously available - this seems to
// run before inline scripts in the page itself, let alone the
// main app code. Nonetheless, to be safe the UI can wait for
// the preload promise here to confirm it's definitely ready.
let desktopVersion: string | undefined;
let authToken: string | undefined;
let deviceInfo: {} | undefined;

const preloadPromise = Promise.all([
    ipcInvoke('get-desktop-version')
        .then(result => { desktopVersion = result; }),
    ipcInvoke('get-server-auth-token')
        .then(result => { authToken = result; }),
    Promise.race([
        ipcInvoke('get-device-info')
            .then(result => { deviceInfo = result; }),
        // Give up after 500m - might complete later, but we don't
        // want to block 'API ready' for this info.
        new Promise((resolve) => setTimeout(resolve, 500))
    ])
]);

contextBridge.exposeInMainWorld('desktopApi', {
    waitUntilDesktopApiReady: () => preloadPromise.then(() => {}),

    getDesktopVersion: () => desktopVersion,
    getServerAuthToken: () => authToken,
    getDeviceInfo: () => deviceInfo,

    selectApplication: () =>
        ipcInvoke('select-application'),
    selectFilePath: () =>
        ipcInvoke('select-file-path'),
    selectSaveFilePath: () =>
        ipcInvoke('select-save-file-path'),

    openContextMenu: (options: ContextMenuDefinition) =>
        ipcInvoke('open-context-menu', options),

    restartApp: () =>
        ipcInvoke('restart-app')
});