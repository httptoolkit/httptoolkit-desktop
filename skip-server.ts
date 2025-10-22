import * as path from 'path';
import * as fs from "fs/promises";

const canAccess = (file: string) => fs.access(file).then(() => true).catch(() => false);
const deleteDir = (p: string) => fs.rm(p, { recursive: true, force: true });

// For a full local dev environment, we want to use a standalone UI & server running externally.
// This lets us edit both and the desktop together. We do this by creating a fake server,
// which doesn't exit, but otherwise does nothing.
async function setUpDevEnv() {
    const serverFolder = path.join(__dirname, 'httptoolkit-server');
    const serverExists = await canAccess(serverFolder);

    if (serverExists) await deleteDir(serverFolder);

    const binFolder = path.join(serverFolder, 'bin');
    await fs.mkdir(binFolder, { recursive: true });

    // Create a node/*nix-runnable fake-server that just sleeps forever:
    const script = path.join(binFolder, "httptoolkit-server");
    await fs.writeFile(script, `#!/usr/bin/env node
        setInterval(() => {}, 999999999);
    `);
    await fs.chmod(script, 0o755);

    // Create a windows wrapper for that script:
    const winWrapper = path.join(binFolder, "httptoolkit-server.cmd");
    await fs.writeFile(winWrapper, `node "%~dp0\\httptoolkit-server" %*`);
}

setUpDevEnv().catch(e => {
    console.error(e);
    process.exit(1);
});
