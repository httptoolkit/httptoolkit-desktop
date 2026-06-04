import { promises as fs } from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import type { Session } from 'electron';

// The UI is cached (service worker) and should stay roughly in sync with the bundled server version, to
// avoid hard-to-test incompatibilities from version skew. Normally both update together during regular
// use. But a large desktop upgrade (or uninstall/reinstall) after a long gap can pair a fresh server
// with a stale cached UI. To catch that, on a desktop upgrade following a 45+ day gap we clear the UI
// cache so the next launch fetches a fresh, compatible UI. We never clear during normal usage, or for
// recent upgrades where the cached UI is likely still current.

const LAST_RUN_FILE = 'desktop-last-run.json';
const WINDOW_STATE_FILE = 'window-state.json'; // Window state file - fallback mtime check for old versions
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AGE_MS = 45 * DAY_MS;

interface LastRunData {
    version: string;
    timestamp: number;
}

// Read previous run record, or null if we've never written one (first run, or a pre-v1.27 install).
const readLastRun = async (filePath: string): Promise<LastRunData | null> => {
    let content: string;
    try {
        content = await fs.readFile(filePath, 'utf8');
    } catch (e: any) {
        if (e.code === 'ENOENT') return null;
        throw e;
    }

    const parsed = JSON.parse(content);
    if (
        typeof parsed?.version === 'string' &&
        typeof parsed?.timestamp === 'number' &&
        Number.isFinite(parsed.timestamp)
    ) {
        return { version: parsed.version, timestamp: parsed.timestamp };
    } else {
        throw new Error(`Invalid last run data in ${filePath}`);
    }
};

// The window-state.json mtime, or null if absent. Used as a last-used fallback for pre-v1.27 installs,
// which have no run record of their own but do leave this behind on every window move/resize/close.
const readWindowStateMtime = async (userDataPath: string): Promise<number | null> => {
    try {
        const stats = await fs.stat(path.join(userDataPath, WINDOW_STATE_FILE));
        return stats.mtimeMs;
    } catch (e: any) {
        if (e.code === 'ENOENT') return null;
        throw e;
    }
};

// Atomic write (write-then-rename) to avoid leaving a torn file behind if interrupted.
const writeLastRun = async (filePath: string, data: LastRunData): Promise<void> => {
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data), 'utf8');
    await fs.rename(tmpPath, filePath);
};

export const shouldClearStaleUICache = async (options: {
    userDataPath: string,
    currentVersion: string,
    log?: (message: string) => void,
    reportError?: (error: Error | string) => void
}): Promise<boolean> => {
    const { userDataPath, currentVersion, log = () => {}, reportError = () => {} } = options;

    try {
        const previousRunInfo = await readLastRun(path.join(userDataPath, LAST_RUN_FILE));

        // With a record we compare versions and use its timestamp. If it doesn't exist then it must be
        // an upgrade (pre-v1.27 install), and we use the window-state mtime for timing (close enough).
        const isUpgrade = previousRunInfo ? semver.gt(currentVersion, previousRunInfo.version) : true;
        const lastUsed = previousRunInfo ? previousRunInfo.timestamp : await readWindowStateMtime(userDataPath);

        if (lastUsed === null || !isUpgrade) return false;

        const age = Date.now() - lastUsed;
        if (age <= STALE_AGE_MS) {
            log(`Desktop upgraded, but UI cache is recent (${Math.round(age / DAY_MS)} days) so not reset`);
            return false;
        }

        log(`Clearing UI cache: upgraded from ${
            previousRunInfo ? previousRunInfo.version : '(unknown)'
        } to ${
            currentVersion
        }, last used ${Math.round(age / DAY_MS)} days ago`);
        return true;
    } catch (e) {
        log(`Failed to check stale UI cache: ${e}`);
        reportError(e instanceof Error ? e : String(e));
        return false;
    }
};

// Clears only the offline UI cache (service worker + cache storage + HTTP cache) and nothing else
export const clearUICache = async (targetSession: Session): Promise<void> => {
    await targetSession.clearStorageData({
        storages: ['serviceworkers', 'cachestorage']
    });
    await targetSession.clearCache();
};

// Records this run for the next startup to compare against - must be run after above checks.
export const recordUIRun = async (
    userDataPath: string,
    currentVersion: string
): Promise<void> => {
    await writeLastRun(path.join(userDataPath, LAST_RUN_FILE), {
        version: currentVersion,
        timestamp: Date.now()
    });
};
