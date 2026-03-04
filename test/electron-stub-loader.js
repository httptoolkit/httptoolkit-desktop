// ESM loader hook that stubs the 'electron' module and '@sentry/electron/main'
// when running in plain Node.js (outside Electron). This allows test files to
// import build output that transitively depends on these packages without
// hitting import errors or Electron-specific initialization failures.

const ELECTRON_STUB_URL = 'stub://electron';
const SENTRY_STUB_URL = 'stub://sentry-electron';

export function resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
        return { url: ELECTRON_STUB_URL, shortCircuit: true };
    }
    if (specifier === '@sentry/electron/main' || specifier === '@sentry/electron') {
        return { url: SENTRY_STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
    if (url === ELECTRON_STUB_URL) {
        return { format: 'module', source: ELECTRON_STUB, shortCircuit: true };
    }
    if (url === SENTRY_STUB_URL) {
        return { format: 'module', source: SENTRY_STUB, shortCircuit: true };
    }
    return nextLoad(url, context);
}

// Stub for @sentry/electron/main — provides the API surface used by errors.ts
// as no-ops, avoiding all Electron-specific Sentry initialization.
const SENTRY_STUB = `
export function init() {}
export function rewriteFramesIntegration() { return {}; }
export function setUser() {}
export function captureMessage() {}
export function captureException() {}
export function addBreadcrumb() {}
`;

// Stub for the 'electron' module — a recursive Proxy that silently absorbs
// any property access or function call, as a safety net for any other code
// that imports electron outside of the Electron runtime.
const ELECTRON_STUB = `
const noop = () => {};
const handler = {
    get: (_, prop) => {
        if (typeof prop === 'symbol') return undefined;
        return new Proxy(noop, handler);
    },
    apply: () => new Proxy(noop, handler)
};
const stub = new Proxy(noop, handler);

export default stub;
export const app = stub;
export const BrowserWindow = stub;
export const Menu = stub;
export const dialog = stub;
export const session = stub;
export const ipcMain = stub;
export const shell = stub;
export const net = stub;
export const protocol = stub;
export const webContents = stub;
export const crashReporter = stub;
export const powerMonitor = stub;
export const screen = stub;
export const autoUpdater = stub;
export const Session = stub;
export const MessageChannelMain = stub;
`;
