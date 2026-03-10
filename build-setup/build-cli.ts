import { execFileSync } from 'child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';

const SEA_CONFIG = 'src/cli/sea-config.json';
const SEA_BLOB = 'build/cli/cli.blob';
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const CLI_BINARY = 'httptoolkit-cli' + (process.platform === 'win32' ? '.exe' : '');

// Generate the single-executable-application blob from the compiled CLI JS:
console.log('Generating SEA blob...');
execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], {
    stdio: 'inherit'
});

// Copy the current Node binary to use as the CLI executable:
console.log('Copying node binary...');
copyFileSync(process.execPath, CLI_BINARY);

// Remove the existing code signature before injection, since modifying the
// binary without doing so corrupts the PE/Mach-O structure:
if (process.platform === 'darwin') {
    console.log('Removing macOS code signature...');
    execFileSync('codesign', ['--remove-signature', CLI_BINARY]);
} else if (process.platform === 'win32') {
    console.log('Removing Windows Authenticode signature...');
    stripPESignature(CLI_BINARY);
}

// Inject the SEA blob into the copied binary:
console.log('Injecting SEA blob...');
const postjectArgs = [
    'postject', CLI_BINARY,
    'NODE_SEA_BLOB', SEA_BLOB,
    '--sentinel-fuse', SENTINEL_FUSE
];
if (process.platform === 'darwin') {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
}
execFileSync('npx', postjectArgs, { stdio: 'inherit', shell: true });

// On macOS, re-apply an ad-hoc signature so the binary is valid:
if (process.platform === 'darwin') {
    console.log('Re-signing macOS binary...');
    execFileSync('codesign', ['--sign', '-', CLI_BINARY]);
}

console.log('CLI build completed.');

/**
 * Strip the Authenticode signature from a Windows PE binary by zeroing out the
 * Certificate Table data directory entry and truncating the appended signature.
 * Existing tools to do this are hard to reliably call in CI so this is easier.
 */
function stripPESignature(filePath: string) {
    const buf = Buffer.from(readFileSync(filePath));

    // PE offset is stored at 0x3C in the DOS header
    const peOffset = buf.readUInt32LE(0x3C);

    // Optional header starts after PE\0\0 signature (4 bytes) + COFF header (20 bytes)
    const optHeaderOffset = peOffset + 24;
    const magic = buf.readUInt16LE(optHeaderOffset);

    // Data directories start after the fixed optional header fields:
    // PE32 (0x10B) = 96 bytes, PE32+ (0x20B) = 112 bytes
    const dataDirOffset = optHeaderOffset + (magic === 0x20B ? 112 : 96);

    // Certificate Table is data directory entry index 4 (each entry is 8 bytes)
    const certEntryOffset = dataDirOffset + 4 * 8;
    const certDataOffset = buf.readUInt32LE(certEntryOffset);

    if (certDataOffset === 0) return; // No signature present

    // Zero out the Certificate Table directory entry
    buf.writeUInt32LE(0, certEntryOffset);
    buf.writeUInt32LE(0, certEntryOffset + 4);

    // Truncate the file to remove the appended signature data
    writeFileSync(filePath, buf.subarray(0, certDataOffset));
}
