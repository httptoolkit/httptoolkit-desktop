import * as path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import * as esbuild from 'esbuild';

const rootDir = path.join(import.meta.dirname, '..');
const srcDir = path.join(rootDir, 'src');
const buildDir = path.join(rootDir, 'build');

// Bundling avoids loading ~1000 separate module files on every startup. Native modules
// can't be bundled, so they stay external and load from node_modules at runtime.
const external = ['electron', 'registry-js'];

async function buildSrc() {
    await fs.rm(buildDir, { recursive: true, force: true });

    await Promise.all([
        esbuild.build({
            entryPoints: [path.join(srcDir, 'index.ts')],
            outfile: path.join(buildDir, 'index.js'),
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node22',
            external,
            sourcemap: 'linked',
            // Bundled CJS dependencies require() Node builtins, which ESM output doesn't provide:
            banner: {
                js: "import { createRequire as __createRequire } from 'module'; " +
                    "const require = __createRequire(import.meta.url);"
            },
            logLevel: 'warning'
        }),
        esbuild.build({
            entryPoints: [path.join(srcDir, 'preload.cts')],
            outfile: path.join(buildDir, 'preload.cjs'),
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: 'node22',
            external: ['electron'],
            // No sourcemap: the renderer would try to fetch it from the UI's origin
            sourcemap: false,
            logLevel: 'warning'
        })
    ]);
}

await buildSrc();

if (process.argv.includes('--run')) {
    // Outside Electron itself, the electron package exports the path to its binary:
    const electronPath: string = createRequire(import.meta.url)('electron');
    const electron = spawn(electronPath, ['.'], { cwd: rootDir, stdio: 'inherit' });
    electron.on('exit', (code) => process.exit(code ?? 0));
}
