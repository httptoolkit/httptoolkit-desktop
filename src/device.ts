import * as os from 'os';
import { promises as fs } from 'fs'
import { promisify } from 'util';
import { exec } from 'child_process';
const execAsync = promisify(exec);

import { logError } from './errors.ts';

export async function getDeviceDetails(): Promise<{
    platform: string;
    release: string;
    runtimeArch: string;
    realArch: string;
}> {
    const [
        realArch,
        osDetails
    ] = await Promise.all([
        getRealArch(),
        getOsDetails()
    ]);

    return {
        ...osDetails,
        runtimeArch: os.arch(),
        realArch: realArch
    }
}

const majorMinorOnly = <I extends string | undefined>(input: I): I =>
    input?.split('.').slice(0, 2).join('.') as I;

async function getOsDetails() {
    const rawPlatform = os.platform();
    if (rawPlatform == 'linux') {
        return await getLinuxOsDetails();
    } else if (rawPlatform === 'win32') {
        // For Windows, the version numbers are oddly precise and weird. We simplify:
        return {
            platform: rawPlatform,
            release: getWindowsVersion()
        };
    } else {
        return {
            platform: rawPlatform,
            release: majorMinorOnly(os.release())
        }
    }
}

function getWindowsVersion() {
    const rawVersion = os.release();
    try {
        if (rawVersion.startsWith('10.0.')) {
            // Windows 10.0.x < 22000 is Windows 10, >= 22000 is Windows 11
            const buildNumber = parseInt(rawVersion.slice('10.0.'.length), 10);
            if (isNaN(buildNumber)) return 'Unknown';
            else if (buildNumber >= 22000) return '11';
            else return '10'
        } else {
            // Other versions - e.g. 6.3 is Windows 8.1
            return majorMinorOnly(rawVersion);
        }
    } catch (e) {
        logError(`Failed to detect windows version: ${e.message || e}`);
        return 'Unknown';
    }
}

async function getLinuxOsDetails() {
    // For Linux, there's a relatively small number of users with a lot of variety.
    // We do a bit more digging, to try to get meaningful data (e.g. distro) and
    // drop unnecessary fingerprinting factors (kernel patch version & variants etc). End
    // result is e.g. "ubuntu + 20.04" (just major+minor, for big distros supporting
    // /etc/os-release) or "linux + 6.5" (just kernel major+minor).
    try {
        const osReleaseDetails = await fs.readFile('/etc/os-release', 'utf8')
            .catch(() => '');
        const osRelease = osReleaseDetails.split('\n').reduce((acc, line) => {
            const [key, value] = line.split('=');
            if (key && value) {
                acc[key] = value.replace(/(^")|("$)/g, '');
            }
            return acc;
        }, {} as { [key: string]: string | undefined });

        return {
            platform: osRelease['ID'] || osRelease['NAME'] || 'linux',
            release: majorMinorOnly(osRelease['VERSION_ID']) || 'Unknown'
        };
    } catch (e) {
        logError(`Failed to detect Linux version: ${e.message}`);
        return {
            platform: 'linux',
            release: 'Unknown'
        };
    }
}

// Detect the 'real' architecture of the system. We're concerned here with detecting the real arch
// despite emulation here, to help with launch subprocs. Not too worried about x86 vs x64.
async function getRealArch() {
    try {
        switch (process.platform) {
            case 'darwin':
                const { stdout: armCheck } = await execAsync('sysctl -n hw.optional.arm64')
                    .catch((e: any) => {
                        const output = e.message + e.stdout + e.stderr;
                        // This id may not be available:
                        if (output?.includes?.("unknown oid")) return { stdout: "0" };
                        else throw e;
                    });
                if (armCheck.trim() === '1') {
                    return 'arm64';
                } else {
                    break;
                }

            case 'linux':
                const { stdout: cpuInfo } = await execAsync('cat /proc/cpuinfo');
                const lcCpuInfo = cpuInfo.toLowerCase();
                if (lcCpuInfo.includes('aarch64') || lcCpuInfo.includes('arm64')) {
                    return 'arm64';
                } else {
                    break;
                }

            case 'win32':
                const arch = process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE;
                if (arch?.toLowerCase() === 'arm64') {
                    return 'arm64';
                } else {
                    break;
                }
        }
    } catch (e) {
        console.warn(`Error querying system arch: ${e.message}`);
        logError(e);
    }

    return os.arch();
}