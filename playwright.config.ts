import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test',
    timeout: 30000,
    workers: 1,
    retries: 0,
    reporter: 'list',
    outputDir: '.playwright'
});
