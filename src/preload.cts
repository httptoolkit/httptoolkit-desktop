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

// [DIAG] Report what the preload actually received. This is the crux: under --no-sandbox (arm64 CI)
// vs the default sandbox (x64 CI), confirm whether additionalArguments reach process.argv here.
// These console.* calls surface in the CI log via the main process' console-message echo.
try {
    const sandboxed = (process as unknown as { sandboxed?: boolean }).sandboxed;
    console.log('[DIAG][PRELOAD] sandboxed=', sandboxed, 'argvLen=', process.argv.length);
    console.log('[DIAG][PRELOAD] process.argv=', JSON.stringify(process.argv));
    console.log('[DIAG][PRELOAD] parsed:',
        'desktopVersion=', desktopVersion,
        'authTokenPresent=', !!authToken, 'authTokenLen=', authToken ? authToken.length : 0,
        'serverPort=', serverPort,
        'mockttpPort=', mockttpPort
    );
} catch (e) {
    console.log('[DIAG][PRELOAD] diagnostics threw:', e);
}

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
