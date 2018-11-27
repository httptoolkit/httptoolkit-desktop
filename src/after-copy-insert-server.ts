import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import fetch from 'node-fetch';

const targz = require('targz');
const extractTarGz = promisify(targz.decompress);
const deleteFile = promisify(fs.unlink);

/*
* Download the latest server binary and include it in the build directly.
* We use the binary build rather than just depending on this through npm
* because the binary builds are capable of autoupdating all by themselves,
* and because it makes it possible for users to run the server directly
* with minimal effort, if they so choose.
*/
export = async function (buildPath: string, _electronVersion: string, platform: string, arch: string, callback: Function) {
    try {
        console.log(`Downloading httptoolkit-server for ${platform}-${arch}`);

        const serverVersion = new RegExp(`httptoolkit-server-v\\d+\\.\\d+\\.\\d+-${platform}-${arch}.tar.gz`);

        const headers = process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}

        const response = await fetch(
            'https://api.github.com/repos/httptoolkit/httptoolkit-server/releases/latest',
            { headers }
        );

        const release = await response.json();
        if (!release || !release.assets) {
            console.error(JSON.stringify(release, null, 2));
            throw new Error('Could not retrieve release assets');
        }

        const asset = release.assets.filter((asset: { name: string }) => asset.name.match(serverVersion))[0];

        if (!asset) {
            throw new Error(`No server available matching ${serverVersion.toString()}`);
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

        callback();
    } catch (e) {
        console.error(e);
        callback(e);
    }
}
