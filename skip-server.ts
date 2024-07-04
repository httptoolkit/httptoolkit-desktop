import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import rimraf from 'rimraf';

const canAccess = (file: string) => promisify(fs.access)(file).then(() => true).catch(() => false);
const deleteDir = promisify(rimraf);
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const chmod = promisify(fs.chmod);

// For a full local dev environment, we want to use a standalone UI & server running externally.
// This lets us edit both and the desktop together. We do this by creating a fake server,
// which doesn't exit, but otherwise does nothing.
async function setUpDevEnv() {
    const serverFolder = path.join(__dirname, 'httptoolkit-server');
    const serverExists = await canAccess(serverFolder);

    if (serverExists) await deleteDir(serverFolder);

    const binFolder = path.join(serverFolder, 'bin');
    await mkdir(binFolder, { recursive: true });

    // Create a node/*nix-runnable fake-server that just sleeps forever:
    const script = path.join(binFolder, "httptoolkit-server");
    await writeFile(script, `#!/usr/bin/env node
        setInterval(() => {}, 999999999);
    `);
    await chmod(script, 0o755);

    // Create a windows wrapper for that script:
    const winWrapper = path.join(binFolder, "httptoolkit-server.cmd");
    await writeFile(winWrapper, `node "%~dp0\\httptoolkit-server" %*`);
}

setUpDevEnv().catch(e => {
    console.error(e);
    process.exit(1);
});
