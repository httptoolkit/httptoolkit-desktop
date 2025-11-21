import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test',
    timeout: 20000,
    workers: 1,
    retries: 0,
    reporter: 'list',
    outputDir: '.playwright'
});
