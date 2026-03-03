import { execFileSync, execSync } from 'child_process';

const SEA_CONFIG = 'src/cli/sea-config.json';
const CLI_BINARY = 'httptoolkit-cli';
const SEA_BLOB = 'build/cli/cli.blob';
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// Generate the single-executable-application blob from the compiled CLI JS:
console.log('Generating SEA blob...');
execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], {
    stdio: 'inherit'
});

// Copy the current Node binary to use as the CLI executable:
console.log('Copying node binary...');
const nodePath = execSync('which node', { encoding: 'utf8' }).trim();
execFileSync('cp', [nodePath, CLI_BINARY]);

// Inject the SEA blob into the copied binary:
console.log('Injecting SEA blob...');
execFileSync('npx', [
    'postject', CLI_BINARY,
    'NODE_SEA_BLOB', SEA_BLOB,
    '--sentinel-fuse', SENTINEL_FUSE
], {
    stdio: 'inherit'
});

console.log('CLI build completed.');
