// Preload script that registers the ESM loader hooks for stubbing
// electron and @sentry/electron when running outside Electron.
// Use via: node --import ./test/register-stubs.js ...
import { register } from 'node:module';
register(new URL('./electron-stub-loader.js', import.meta.url));
