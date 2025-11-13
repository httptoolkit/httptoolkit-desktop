import * as path from 'path';
import { readFileSync, writeFileSync } from 'fs';

function removeSourceMapAnnotation(filePath: string): void {
    const fileContent = readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n');

    if (lines[lines.length - 1].startsWith('//# sourceMappingURL=')) {
        lines.pop(); // Remove the last line
    } else {
        console.log(`No sourcemap annotation found in ${filePath}`);
        return;
    }

    const newContent = lines.join('\n');
    writeFileSync(filePath, newContent, 'utf8');
    console.log(`Sourcemap annotation removed from ${filePath}`);
}

// We have to strip the source map comment from here, otherwise when it loads
// in Chrome, it tries to get preload.js.map from the real server, leaving
// us with an annoying error because that's never going to work.
const filePath = path.join(import.meta.dirname, 'build', 'preload.js');
removeSourceMapAnnotation(filePath);