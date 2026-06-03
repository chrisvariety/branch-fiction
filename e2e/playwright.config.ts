import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  timeout: 30_000,

  projects: [
    {
      name: 'browser',
      use: {
        ...devices['Desktop Chrome'],
        trace: 'retain-on-failure'
      }
    }
  ],

  webServer: {
    command: 'pnpm dev',
    port: 1420,
    reuseExistingServer: !process.env.CI,
    cwd: '..'
  }
});
