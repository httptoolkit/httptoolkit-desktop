require('ts-node/register');

const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const rimraf = require('rimraf');
const insertServer = promisify(require('./src/after-copy-insert-server'));

const canAccess = (file) => promisify(fs.access)(file).then(() => true).catch(() => false);
const deleteDir = promisify(rimraf);

const packageJsonLock = require('./package-lock.json');
const requiredServerVersion = packageJsonLock.dependencies['httptoolkit-server'].version;

// For local testing of the desktop app, we need to pull the latest server and unpack it.
// This real prod server will then be used with the real prod web UI, but this local desktop app.
// Manually trigger the after-copy hook, to give us an env like the real package
async function setUpLocalEnv() {
    const serverExists = await canAccess('./httptoolkit-server');
    const serverVersion = serverExists ? require('./httptoolkit-server/package.json').version : null;

    if (serverVersion !== requiredServerVersion) {
        if (serverExists) await deleteDir('./httptoolkit-server');
        await insertServer(__dirname, '', os.platform(), os.arch());
        console.log('Local setup completed.');
    } else {
        console.log('Correct server already downloaded, nothing to do.');
    }
}

setUpLocalEnv().catch(e => {
    console.error(e);
    process.exit(1);
});