require('ts-node/register');

const { promisify } = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');
const rimraf = require('rimraf');

const canAccess = (file) => promisify(fs.access)(file).then(() => true).catch(() => false);
const deleteDir = promisify(rimraf);
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const chmod = promisify(fs.chmod);

const sleepForeverScript = `#!/usr/bin/env node
setInterval(() => {}, 999999999);
`;

// For a full local dev environment, we want to use a standalone UI & server running externally.
// This lets us edit both and the desktop together. We do this by creating a fake server,
// which doesn't exit, but otherwise does nothing.
async function setUpDevEnv() {
    const serverFolder = path.join(__dirname, 'httptoolkit-server');
    const serverExists = await canAccess(serverFolder);

    if (serverExists) await deleteDir(serverFolder);

    const binFolder = path.join(serverFolder, 'bin');
    await mkdir(binFolder, { recursive: true });

    const bins = ['httptoolkit-server', 'httptoolkit-server.cmd'].map((bin) => path.join(binFolder, bin));
    await Promise.all(bins.map(async (bin) => {
        await writeFile(bin, sleepForeverScript);
        await chmod(bin, 0o755);
    }));
}

setUpDevEnv().catch(e => {
    console.error(e);
    process.exit(1);
});
