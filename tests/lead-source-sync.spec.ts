import { test } from '@playwright/test';
import { fetchQuotableLeads, resolveDateRange } from '../lib/whatconverts';
import { sendRunSummaryEmail, RunStats } from '../lib/mailer';
import { processLead } from '../lib/leadProcessor';
import holmesMapping from '../config/clients/holmes_lawn_pest.json';

/**
 * SA Lead Source Sync — Holmes Lawn & Pest (single client).
 *
 * Pulls unique, quotable (Yes/Pending) WhatConverts leads for a date range
 * (defaults to "yesterday"; override with START_DATE/END_DATE in .env or as
 * env vars on the command line), finds each one in Service Autopilot via the
 * global search, and sets the Sales-tab Source dropdown to match per Holmes'
 * UTM -> SA mapping table (config/clients/holmes_lawn_pest.json).
 *
 * For multiple clients, use tests/multi-client-sync.spec.ts instead.
 *
 * Usage:
 *   npx playwright test lead-source-sync                # yesterday
 *   START_DATE=2026-06-01 END_DATE=2026-06-30 npx playwright test lead-source-sync
 *
 * Runs headed by default per client preference (see playwright.config.ts).
 * A single summary email is sent at the end via lib/mailer.ts, always
 * including how many clients were updated, plus any not-found clients and
 * unmatched UTM source/medium combos.
 */

test.setTimeout(15 * 60 * 1000); // generous — this walks many client records

test('sync SA lead sources from WhatConverts (Holmes Lawn & Pest)', async ({ page }) => {
  const range = resolveDateRange();
  console.log(`Pulling WhatConverts leads for ${range.start} to ${range.end}`);

  const leads = await fetchQuotableLeads(range);
  console.log(`Found ${leads.length} unique, quotable leads`);

  const stats: RunStats = { updated: [], notFound: [], unmatched: [], errored: [] };

  for (const lead of leads) {
    await test.step(`${lead.contact_name} (${lead.lead_type}, ${lead.lead_source}/${lead.lead_medium})`, async () => {
      await processLead(page, lead, holmesMapping, stats);
    });
  }

  console.log(
    `Updated: ${stats.updated.length} | Not found: ${stats.notFound.length} | Unmatched: ${stats.unmatched.length} | Errored: ${stats.errored.length}`,
  );
  await sendRunSummaryEmail(stats, range);
});
