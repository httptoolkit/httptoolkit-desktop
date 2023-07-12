import { notarize } from 'electron-notarize'

const projectRoot = require('path').resolve(__dirname, '..');

// We currently manually notarize with this script & electron-notarize.
// This is now built into electron-builder, so we could migrate to that
// instead! It shouldn't make much difference, since it uses @electron/notarize
// which is actually the exact same package but pulled into the official
// namespace, and the options appear identical. That said, probably a
// nice TODO at some point to simplify by dropping this & after-sign.js.
// Maybe we can drop entitlements.plist en route too?

export = async function () {
    if (process.platform !== 'darwin') {
        console.log('Skipping notarization - not building for Mac');
        return;
    }

    console.log('Notarizing...');

    return notarize({
        appBundleId: 'tech.httptoolkit.desktop',
        appPath: projectRoot + '/dist/mac/HTTP Toolkit.app',
        appleId: process.env.APPLE_ID!,
        appleIdPassword: process.env.APPLE_ID_PASSWORD!
    }).catch((e) => {
        console.error(e);
        throw e;
    });
}