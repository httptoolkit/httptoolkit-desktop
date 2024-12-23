import { contextBridge, ipcRenderer } from 'electron';

import type { ContextMenuDefinition } from './context-menu';

// These are technically asynchronous, but they're so fast that
// they're effectively sychronously available - this seems to
// run before inline scripts in the page itself, let alone the
// main app code. Nonetheless, to be safe the UI can wait for
// the preload promise here to confirm it's definitely ready.
let desktopVersion: string | undefined;
let authToken: string | undefined;

const preloadPromise = Promise.all([
    ipcRenderer.invoke('get-desktop-version').then(result => {
        desktopVersion = result;
    }),
    ipcRenderer.invoke('get-server-auth-token').then(result => {
        authToken = result;
    })
]);

contextBridge.exposeInMainWorld('desktopApi', {
    waitUntilDesktopApiReady: () => preloadPromise.then(() => {}),

    getDesktopVersion: () => desktopVersion,
    getServerAuthToken: () => authToken,

    selectApplication: () =>
        ipcRenderer.invoke('select-application'),
    selectFilePath: () =>
        ipcRenderer.invoke('select-file-path'),

    openContextMenu: (options: ContextMenuDefinition) =>
        ipcRenderer.invoke('open-context-menu', options),

    restartApp: () =>
        ipcRenderer.invoke('restart-app')
});