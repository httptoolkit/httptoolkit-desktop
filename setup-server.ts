require('ts-node/register');

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promisify } from 'util';

import * as _ from 'lodash';
import * as semver from 'semver';
import fetch from 'node-fetch';
import * as rimraf from 'rimraf';
import * as targz from 'targz';

const extractTarGz = promisify(targz.decompress);
const deleteFile = promisify(fs.unlink);

const canAccess = (path: string) => promisify(fs.access)(path).then(() => true).catch(() => false);
const deleteDir = promisify(rimraf);

const packageJson = require('./package.json');
const requiredServerVersion = 'v' + packageJson.config['httptoolkit-server-version'];

// For local testing of the desktop app, we need to pull the latest server and unpack it.
// This real prod server will then be used with the real prod web UI, but this local desktop app.
async function setUpLocalEnv() {
    const serverExists = await canAccess('./httptoolkit-server/package.json');
    const serverVersion = serverExists ? require('./httptoolkit-server/package.json').version : null;

    if (!serverVersion || semver.neq(serverVersion, requiredServerVersion)) {
        if (serverExists) await deleteDir('./httptoolkit-server');
        await insertServer(__dirname, os.platform(), os.arch());
        console.log('Server setup completed.');
    } else {
        console.log('Correct server already downloaded.');
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
    const assetWrite = assetDownload.body.pipe(fs.createWriteStream(downloadPath));

    await new Promise((resolve, reject) => {
        assetWrite.on('finish', resolve);
        assetWrite.on('error', reject);
    });

    console.log(`Extracting server to ${buildPath}`);
    await extractTarGz({ src: downloadPath, dest: buildPath });
    await deleteFile(downloadPath);

    console.log('Server download completed');
}

setUpLocalEnv().catch(e => {
    console.error(e);
    process.exit(1);
});