import * as net from 'net';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { delay } from '@httptoolkit/util';

const execFileAsync = promisify(execFile);

const isWindows = os.platform() === 'win32';

export const SERVER_PORTS = [45456, 45457] as const;

/**
 * Check if any of the given ports are currently in use (something is listening).
 * Returns the list of ports that are in use.
 */
export async function checkPortsInUse(host: string, ports: number[]): Promise<number[]> {
    const results = await Promise.all(
        ports.map(async (port) => {
            const inUse = await isPortInUse(host, port);
            return inUse ? port : null;
        })
    );

    return results.filter((port): port is number => port !== null);
}

async function isPortInUse(host: string, port: number): Promise<boolean> {
    const conn = net.connect({ host, port });

    try {
        return await Promise.race([
            new Promise<boolean>((resolve) => {
                // If we can connect, something is listening on this port
                conn.on('connect', () => resolve(true));
                // If we fail to connect, the port is probably available
                conn.on('error', () => resolve(false));
            }),
            // After 100ms with no connection, assume the port is available
            delay(100).then(() => false)
        ]);
    } finally {
        conn.destroy();
    }
}

/**
 * On Windows, Hyper-V (used by WSL2 and Docker) can reserve ports, making them unavailable
 * even though nothing is actively listening. This checks for that specific case.
 * Returns the list of ports that are in the Windows excluded port range.
 */
export async function checkWindowsReservedPorts(ports: number[]): Promise<number[]> {
    if (!isWindows) return [];

    try {
        const { stdout } = await execFileAsync('netsh', [
            'int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'
        ]);

        // Parse the output to find excluded ranges. Format is like:
        //     Start Port    End Port
        //     ----------    --------
        //          50000       50099
        //          50100       50199  *
        const excludedPorts: number[] = [];

        for (const line of stdout.split('\n')) {
            const match = line.match(/^\s*(\d+)\s+(\d+)/);
            if (match) {
                const startPort = parseInt(match[1], 10);
                const endPort = parseInt(match[2], 10);

                for (const port of ports) {
                    if (port >= startPort && port <= endPort && !excludedPorts.includes(port)) {
                        excludedPorts.push(port);
                    }
                }
            }
        }

        return excludedPorts;
    } catch (e) {
        // If netsh fails for any reason, we can't check - just continue and let
        // normal error handling catch any issues later.
        console.log('Failed to check Windows excluded ports:', e);
        return [];
    }
}
