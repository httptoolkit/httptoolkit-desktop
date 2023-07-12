import * as ChildProcess from 'child_process';
import * as http from 'http';

import { logError } from './errors';
import { delay } from './util';

const isRunning = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        if (e.code === 'ESRCH') return false;
        else throw e;
    }
}

export async function stopServer(proc: ChildProcess.ChildProcess, token: string) {
    await softShutdown(token)
        .catch(logError); // If that fails, continue shutting down anyway

    // In each case, that triggers a clean shutdown. We want to make sure it definitely shuts
    // down though, so we poll the process state, and kill it if it's still running in 3 seconds.

    const deadline = Date.now() + 3000;

    do {
        await delay(100);

        if (Date.now() >= deadline) {
            await hardKill(proc)
                .catch(console.warn); // Not much we can do if this fails really
            break;
        }
    } while (isRunning(proc.pid!))
}

function softShutdown(token: string) {
    // We first try to cleanly shut down the server, so it can clean up after itself.
    // On Mac & Linux, we could shut down the server with SIGTERM, with some fiddling to detach it
    // so that we kill the full shell script + node tree. On Windows that's not possible though,
    // because Windows doesn't support signals at all, and even workarounds to inject SIGINT don't
    // seem to work properly from Electron.

    // To handle all this, we send a HTTP request to the GraphQL API instead, which triggers the same thing.
    return new Promise<void>((resolve, reject) => {
        const req = http.request("http://127.0.0.1:45457", {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'origin': 'https://app.httptoolkit.tech',
                'authorization': `Bearer ${token}`
            }
        });
        req.on('error', reject);

        req.end(JSON.stringify({
            operationName: 'Shutdown',
            query: 'mutation Shutdown { shutdown }',
            variables: {}
        }));

        req.on('response', (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Shutdown request received unexpected ${res.statusCode} response`));
                return;
            }

            const responseChunks: Buffer[] = [];
            res.on('data', (data) => responseChunks.push(data));
            res.on('error', reject);
            res.on('end', () => {
                const rawResponseBody = Buffer.concat(responseChunks);
                try {
                    const responseBody = JSON.parse(rawResponseBody.toString('utf8'));
                    const errors = responseBody.errors as Array<{ message: string, path: string[] }> | undefined;
                    if (errors?.length) {
                        console.error(errors);
                        const errorCount = errors.length > 1 ? `s (${errors.length})` : '';

                        throw new Error(
                            `Server error${errorCount} during shutdown: ${errors.map(e =>
                                `${e.message} at ${e.path.join('.')}`
                            ).join(', ')}`
                        );
                    }

                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
}

async function hardKill(proc: ChildProcess.ChildProcess) {
    if (process.platform !== "win32") {
        process.kill(-proc.pid!, 'SIGKILL');
    } else {
        return new Promise<void>((resolve, reject) => {
            ChildProcess.exec(`taskkill /pid ${proc.pid} /T /F`, (error, stdout, stderr) => {
                if (error) {
                    console.log(stdout);
                    console.log(stderr);
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
}