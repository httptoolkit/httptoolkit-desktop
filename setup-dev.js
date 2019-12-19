require('ts-node/register');

const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

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
    const serverBinFolder = path.join(__dirname, 'httptoolkit-server', 'bin');
    await mkdir(serverBinFolder, { recursive: true });

    const bins = ['httptoolkit-server', 'httptoolkit-server.cmd'].map((bin) => path.join(serverBinFolder, bin));
    await Promise.all(bins.map(async (bin) => {
        await writeFile(bin, sleepForeverScript);
        await chmod(bin, 0o755);
    }));
}

setUpDevEnv().catch(e => {
    console.error(e);
    process.exit(1);
});
