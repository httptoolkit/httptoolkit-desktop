import { notarize } from 'electron-notarize'

const projectRoot = require('path').resolve(__dirname, '..');

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