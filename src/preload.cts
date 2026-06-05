import * as electron from 'electron';
const {
    contextBridge,
    ipcRenderer: { invoke: ipcInvoke },
    webUtils
} = electron;

import type { ContextMenuDefinition } from './context-menu.ts';

// Read values passed sync in additionalArguments:
const readArg = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const arg = process.argv.find(a => a.startsWith(prefix));
    return arg?.slice(prefix.length);
};

const desktopVersion = readArg('htk-desktop-version');
const authToken = readArg('htk-server-auth-token');

const parsePort = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
};
const serverPort = parsePort(readArg('htk-server-port'));
const mockttpPort = parsePort(readArg('htk-mockttp-port'));

let deviceInfo: {} | undefined;
const preloadPromise = Promise.race([
    ipcInvoke('get-device-info').then(result => { deviceInfo = result; }),
    // Give up after 500ms - might complete later, but we don't want to block
    // 'API ready' for this info.
    new Promise((resolve) => setTimeout(resolve, 500))
]);

contextBridge.exposeInMainWorld('desktopApi', {
    waitUntilDesktopApiReady: () => preloadPromise.then(() => {}),

    getDesktopVersion: () => desktopVersion,
    getServerAuthToken: () => authToken,
    getDeviceInfo: () => deviceInfo,

    getServerPort: () => serverPort,
    getMockttpPort: () => mockttpPort,

    selectApplication: () =>
        ipcInvoke('select-application'),
    selectFilePath: () =>
        ipcInvoke('select-file-path'),
    selectSaveFilePath: () =>
        ipcInvoke('select-save-file-path'),

    openContextMenu: (options: ContextMenuDefinition) =>
        ipcInvoke('open-context-menu', options),

    restartApp: () =>
        ipcInvoke('restart-app'),

    setComponentVersions: (versions: Record<string, string>) =>
        ipcInvoke('set-component-versions', versions),

    getPathForFile: (file: File) => webUtils.getPathForFile(file) || null
});
