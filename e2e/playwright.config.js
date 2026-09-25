// Playwright config for the 3-player e2e tests. See e2e/README.md for how to run.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 5 * 60 * 1000,        // a full scripted round, including real IMDb page loads
  expect: { timeout: 15_000 },
  workers: 1,                    // one scenario at a time (each already opens 3 browsers)
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
});
