import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ONE-TIME (per session lifetime) AUTH SETUP for Service Autopilot.
 *
 * Reads credentials from .env, drives the real login once, then saves the
 * logged-in browser session (cookies + localStorage) to state.json.
 * Every other test then reuses that session and skips login entirely.
 *
 * Re-run this whenever the saved session expires:  npm run auth
 */

const authFile = 'playwright/.auth/state.json';

setup('authenticate', async ({ page }) => {
  const { LOGIN_URL, SAP_USER, SAP_PASS } = process.env;

  if (!LOGIN_URL || !SAP_USER || !SAP_PASS) {
    throw new Error(
      'Missing LOGIN_URL / SAP_USER / SAP_PASS. Copy .env.example to .env and fill it in.',
    );
  }

  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  await page.goto(LOGIN_URL);

  // Verified live against my.serviceautopilot.com — plain Email/Password form,
  // no MFA on this account.
  await page.getByRole('textbox', { name: 'Email' }).fill(SAP_USER);
  await page.getByRole('textbox', { name: 'Password' }).fill(SAP_PASS);
  await page.getByRole('button', { name: 'Log In' }).click();

  // Post-login lands on Home.aspx ("My Day"). Wait for both the URL and a
  // signal only present once logged in (the global search icon in the header).
  await page.waitForURL(/Home\.aspx/i, { timeout: 60_000 });
  await expect(page.locator('.v3GlobalSearch--SearchIconArrow')).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: authFile });
  console.log(`Saved authenticated session to ${authFile}`);
});
