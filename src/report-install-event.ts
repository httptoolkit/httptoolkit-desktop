import * as isFirstRun from 'electron-first-run';
import * as setupUA from 'universal-analytics';

/*
This file tracks some basic metric on app installs, uninstalls
and usage. All of this is anonymous, and nothing user identifiable
is sent, it's only used to get an idea of real world app usage.
*/

export function reportStartupEvents() {
    const analytics = setupUA('UA-117670723-2');

    if (process.platform === 'win32') {
        const cmd = process.argv[1];

        // Report installer install/update/uninstall events
        if (cmd === '--squirrel-install') {
            analytics.event("Setup", "Install").send();
        } else if (cmd === '--squirrel-updated') {
            analytics.event("Setup", "Update").send();
        } else if (cmd === '--squirrel-uninstall') {
            analytics.event("Setup", "Uninstall").send();
        }
    }

    if (isFirstRun()) {
        analytics.event("Setup", "First run").send();
    }
}