import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load secrets/config from .env into process.env
dotenv.config();

/**
 * Reliability-first configuration.
 * The priority here is "correct-but-slow beats fast-but-flaky".
 * Timeouts are deliberately generous and tasks run serially so a slow
 * backend never causes a false failure.
 */
export default defineConfig({
  testDir: './tests',

  // Run serially, not in parallel. Stateful business apps (CRMs, quoting
  // tools) don't like concurrent sessions, and serial runs are more predictable.
  fullyParallel: false,
  workers: 1,

  // Retry a failed test rather than giving up — absorbs transient glitches.
  retries: 2,

  // Generous per-test ceiling (2 min). Real automations with waits need room.
  timeout: 120_000,

  expect: {
    // How long expect(...).toBeVisible() etc. will wait for a condition.
    timeout: 20_000,
  },

  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: process.env.BASE_URL,

    // Headed locally (client wants to watch/spot-check runs), headless in CI
    // (GitHub Actions runners have no display; CI=true is set automatically).
    headless: !!process.env.CI,

    // Generous action + navigation timeouts so slow pages don't error out.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,

    // Capture evidence when something does go wrong.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // 1) Auth setup — logs in once as Holmes (using .env) and saves the
    //    session. Only the single-client script needs this.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // 2) Single-client script (Holmes) — starts already logged in via storageState.
    {
      name: 'chromium',
      testMatch: /lead-source-sync\.spec\.ts|example\.task\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/state.json',
      },
      dependencies: ['setup'],
    },

    // 3) Multi-client script — each client logs in fresh in its own isolated
    //    browser context (see tests/multi-client-sync.spec.ts), so this
    //    project needs neither the Holmes-specific setup nor storageState.
    {
      name: 'multi-client',
      testMatch: /multi-client-sync\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
