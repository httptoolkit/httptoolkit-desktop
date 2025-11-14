import * as path from 'path';
import * as os from 'os';
import { promises as fs, createWriteStream, readFileSync } from 'fs'
import { promisify } from 'util';

import _ from 'lodash';
import * as semver from 'semver';
import fetch from 'node-fetch';
import targz from 'targz';
import { execSync } from 'child_process';

import packageJson from './package.json' with { type: 'json' };

const extractTarGz = promisify(targz.decompress);

const canAccess = (path: string) => fs.access(path).then(() => true).catch(() => false);
const deleteDir = (p: string) => fs.rm(p, { recursive: true, force: true });

const requiredServerVersion = 'v' + packageJson.config['httptoolkit-server-version'];

// For local testing of the desktop app, we need to pull the latest server and unpack it.
// This real prod server will then be used with the real prod web UI, but this local desktop app.
async function setUpLocalEnv() {
    const serverExists = await canAccess('./httptoolkit-server/package.json');
    const serverVersion = serverExists
        ? JSON.parse(readFileSync('./httptoolkit-server/package.json').toString()).version
        : null;

    if (!serverVersion || semver.neq(serverVersion, requiredServerVersion)) {
        if (serverExists) await deleteDir('./httptoolkit-server');
        await insertServer(import.meta.dirname, os.platform(), os.arch());
        console.log('Server setup completed.');
    } else {
        console.log('Correct server already downloaded.');
    }

    if (os.platform() !== 'win32') {
        // To work around https://github.com/nodejs/node-gyp/issues/2713,
        // caused by https://github.com/nodejs/node-gyp/commit/b9ddcd5bbd93b05b03674836b6ebdae2c2e74c8c,
        // we manually remove node_gyp_bins subdirectories. Done by shell just
        // because it's a quick easy fix:
        execSync('find httptoolkit-server/node_modules -type d -name node_gyp_bins -prune -exec rm -r {} \\;');
    }
}

/*
* Download the correct server binary and include it in the build directly.
* We use the binary build rather than our actual npm dev dependency
* because the binary builds are capable of autoupdating all by themselves,
* and because it makes it possible for users to run the server directly
* with minimal effort, if they so choose.
*/
async function insertServer(
    buildPath: string,
    platform: string,
    arch: string,
) {
    console.log(`Downloading httptoolkit-server ${requiredServerVersion} for ${platform}-${arch}`);

    const assetRegex = new RegExp(`httptoolkit-server-${requiredServerVersion}-${platform}-${arch}.tar.gz`);

    const headers: { Authorization: string } | {} = process.env.GITHUB_TOKEN
        ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
        : {}

    const response = await fetch(
        'https://api.github.com/repos/httptoolkit/httptoolkit-server/releases',
        { headers }
    );
    if (!response.ok) {
        console.log(`${response.status} response, body: `, await response.text());
        throw new Error(`Server releases request rejected with ${response.status}`);
    }

    const releases = await response.json();

    const release = _.find(releases, { tag_name: requiredServerVersion });

    if (!release || !release.assets) {
        console.error(JSON.stringify(release, null, 2));
        throw new Error('Could not retrieve release assets');
    }

    const asset = release.assets.filter((asset: { name: string }) => asset.name.match(assetRegex))[0];
    if (!asset) {
        throw new Error(`No server available matching ${assetRegex.toString()}`);
    }

    console.log(`Downloading server from ${asset.browser_download_url}...`);

    const downloadPath = path.join(buildPath, 'httptoolkit-server.tar.gz');

    const assetDownload = await fetch(asset.browser_download_url);
    const assetWrite = assetDownload.body.pipe(createWriteStream(downloadPath));

    await new Promise<void>((resolve, reject) => {
        assetWrite.on('finish', resolve);
        assetWrite.on('error', reject);
    });

    console.log(`Extracting server to ${buildPath}`);
    await extractTarGz({
        src: downloadPath,
        dest: buildPath,
        tar: {
            ignore (_, header) {
                // Extract only files & directories - ignore symlinks or similar
                // which can sneak in in some cases (e.g. native dep build envs)
                return header!.type !== 'file' && header!.type !== 'directory'
            }
        }
    });
    await fs.unlink(downloadPath);

    console.log('Server download completed');
}

setUpLocalEnv().catch(e => {
    console.error(e);
    process.exit(1);
});
