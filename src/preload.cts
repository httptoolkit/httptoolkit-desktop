import * as electron from 'electron';
const {
    contextBridge,
    ipcRenderer,
    ipcRenderer: { invoke: ipcInvoke },
    webUtils
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
        ipcInvoke('restart-app'),

    getPathForFile: (file: File) => webUtils.getPathForFile(file) || null,

    setApiOperations: (operations: any[]) => {
        sendToPort({ type: 'operations', operations });
    },
    onOperationRequest: (callback: (operation: string, params: any) => Promise<any>) => {
        operationHandler = callback;
    }
});

// --- Bridge MessagePort setup ---
// The preload owns the port. The page just registers a handler and sets operations.

let apiPort: MessagePort | null = null;
let operationHandler: ((operation: string, params: any) => Promise<any>) | null = null;
let pendingMessages: any[] = [];

function sendToPort(data: any): void {
    if (apiPort) {
        apiPort.postMessage(data);
    } else {
        pendingMessages.push(data);
    }
}

ipcRenderer.send('request-htk-api-port');
ipcRenderer.on('htk-api-port', (event: any) => {
    apiPort = event.ports[0];
    apiPort!.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (data?.type === 'request' && operationHandler) {
            const { id, operation, params } = data;
            Promise.resolve(operationHandler(operation, params))
                .then(result => apiPort!.postMessage({ type: 'response', id, result }))
                .catch(err => apiPort!.postMessage({
                    type: 'response', id, error: String(err?.message ?? err)
                }));
        }
    };
    apiPort!.start();

    for (const msg of pendingMessages) apiPort!.postMessage(msg);
    pendingMessages = [];
});
