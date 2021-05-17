import * as isFirstRun from 'electron-first-run';
import * as setupUA from 'universal-analytics';

/*
This file tracks some basic metric on app first run.
All of this is anonymous, and nothing user identifiable
is sent, it's only used to get an idea of real world app usage.
*/

export function reportStartupEvents() {
    const analytics = setupUA('UA-117670723-2');
    analytics.set("anonymizeIp", true);

    if (isFirstRun()) {
        analytics.event('Setup', 'First run', process.platform).send();
    }
}