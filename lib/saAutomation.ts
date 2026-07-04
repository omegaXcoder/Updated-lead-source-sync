import { expect, Page } from '@playwright/test';
import type { WhatConvertsLead } from './whatconverts';

/**
 * Shared Service Autopilot browser automation — client-agnostic. Every
 * selector here was driven and confirmed live (see PLAYWRIGHT-SOP-AGENT.md
 * rationale in tests/lead-source-sync.spec.ts history). Used by both the
 * single-client script and the multi-client script so a fix in one place
 * fixes both.
 */

export async function loginToSA(page: Page, baseUrl: string, email: string, password: string) {
  await page.goto(baseUrl);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL(/Home\.aspx/i, { timeout: 60_000 });
  await expect(page.locator('.v3GlobalSearch--SearchIconArrow')).toBeVisible({ timeout: 30_000 });
}

/** Lands on Home.aspx fresh. Called before every individual search so each
 * one starts from a known-clean state instead of chaining off whatever the
 * previous search/edit left behind (client's explicit request). */
export async function resetToHome(page: Page) {
  await page.goto('/Home.aspx');
  await expect(page.locator('.v3GlobalSearch--SearchIconArrow')).toBeVisible({ timeout: 30_000 });
}

async function openGlobalSearch(page: Page) {
  const input = page.locator('#searchBarInput');
  if (await input.isVisible().catch(() => false)) return; // already open
  await page.locator('.v3GlobalSearch--SearchIconArrow').click();
  await expect(input).toBeVisible({ timeout: 10_000 });
}

export interface SearchResult {
  name: string;
  href: string;
}

/** Reads the currently-displayed result rows for whichever search tab is active. */
async function readResultRows(page: Page): Promise<SearchResult[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.v3GlobalSearch--SearchBarResultContainer'));
    // @ts-ignore - ko is the page's global Knockout instance
    return rows.map((r) => {
      // @ts-ignore
      const data = window.ko.dataFor(r);
      return { name: data.Name, href: data.Link };
    });
  });
}

/**
 * Searches one query against the "Clients & Leads" tab, and if that comes up
 * empty, also checks "Former Clients & Lead" before giving up (client's
 * explicit request — a match can exist only in the former-clients bucket).
 * Clicking the second tab re-runs the same query automatically (verified
 * live — no need to retype or resubmit).
 */
export async function searchClients(page: Page, query: string): Promise<SearchResult[]> {
  await resetToHome(page);
  await openGlobalSearch(page);

  const input = page.locator('#searchBarInput');
  await input.fill(query);
  await input.press('Enter');

  // "N results" (or "0 results") is the one summary node that's always
  // visible after a search settles, in both tabs — the "No ... Found" empty
  // message next to it is a separate, independently-timed knockout binding
  // that can still be transitioning/hidden at this exact moment (confirmed
  // live: waiting on it directly flaked with a 20s timeout), so anchor the
  // wait on the summary count only, then read whatever rows exist after.
  await page
    .locator('.v3GlobalSearch--Container')
    .getByText(/results/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(500); // let the knockout render finish painting rows

  let results = await readResultRows(page);
  if (results.length > 0) return results;

  await page.getByText('Former Clients & Lead').click();
  await page
    .locator('.v3GlobalSearch--Container')
    .getByText(/results/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(500);

  results = await readResultRows(page);
  return results;
}

/**
 * SA's global search matches phone numbers on the 10-digit local number only
 * — an 11-digit number with the leading US country code returns ZERO
 * results (confirmed live: "13366762072" found nothing, "3366762072" found
 * the record). WhatConverts phone-call leads commonly include the "+1"
 * prefix, so strip it before searching.
 */
export function normalizePhoneForSearch(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** Runs the phone -> email -> name search cascade for non-phone-call lead types. */
export async function findClientRecords(page: Page, lead: WhatConvertsLead): Promise<SearchResult[]> {
  if (lead.lead_type === 'Phone Call') {
    const digits = normalizePhoneForSearch(lead.phone_number);
    return digits ? searchClients(page, digits) : [];
  }

  const candidates = [
    normalizePhoneForSearch(lead.phone_number),
    lead.email_address || '',
    lead.contact_name || '',
  ].filter(Boolean);

  for (const query of candidates) {
    const results = await searchClients(page, query);
    if (results.length > 0) return results;
  }
  return [];
}

export async function openEditSalesTab(page: Page, href: string) {
  await page.goto(new URL(href, page.url()).toString());
  await page.locator('a.links[title="Load Client"]').click();
  // The edit overlay is a knockout-rendered panel; wait for the Sales tab to be clickable.
  await expect(page.locator('span.tab:has-text("Sales")')).toBeVisible({ timeout: 20_000 });
  await page.locator('span.tab:has-text("Sales")').click();
  await expect(page.locator('input[name="Source"]')).toBeVisible({ timeout: 10_000 });
}

export async function getCurrentSource(page: Page): Promise<string> {
  return page.locator('input[name="Source"]').inputValue();
}

export async function setSourceAndSave(page: Page, value: string) {
  const input = page.locator('input[name="Source"]');
  await input.click();
  const option = page.locator('ul.ui-autocomplete:visible li.ui-menu-item a').filter({
    hasText: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  });
  await option.first().click();
  await expect(input).toHaveValue(value);

  // The page has ~14 other hidden "Save" buttons for unrelated dialogs
  // (attachments, invoices, service pause, etc.) scattered in the DOM, so a
  // bare page-wide "Save" text locator is ambiguous. #ctl00 is the edit
  // overlay's own dynamically-injected container — confirmed live that it
  // only exists while THIS overlay is open (it's removed from the DOM the
  // instant Save succeeds), so scoping to it reliably targets the right button.
  await page.locator('#ctl00').getByText('Save', { exact: true }).click();
  // Deliberate settle pause after save — the overlay closes and the page
  // re-renders the client header; give it a moment before moving on.
  await page.waitForTimeout(1500);
}

export async function cancelEdit(page: Page) {
  await page.locator('#ctl00').getByRole('link', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
}
