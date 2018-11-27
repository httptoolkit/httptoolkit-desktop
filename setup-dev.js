require('ts-node/register');

const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const canAccess = (file) => promisify(fs.access)(file).then(() => true).catch(() => false);

async function setUpDevEnv() {
    // Manually trigger the after-copy hook, to give us an env like the real package
    const afterCopy = promisify(require('./src/after-copy-insert-server'));

    if (!await canAccess('./httptoolkit-server')) {
        await afterCopy(__dirname, '', os.platform(), os.arch());
        console.log('Dev setup completed.');
    } else {
        console.log('Server already downloaded, nothing to do.');
    }
}

setUpDevEnv();