import { test } from '@playwright/test';
import { loadActiveClients, loadClientMapping, loadSaLogin } from '../lib/clientConfig';
import { fetchQuotableLeads, resolveDateRange, apiCredentials, resolveProfileId } from '../lib/whatconverts';
import { sendMultiClientSummaryEmail, ClientRunResult, RunStats } from '../lib/mailer';
import { processLead } from '../lib/leadProcessor';
import { loginToSA } from '../lib/saAutomation';

/**
 * SA Lead Source Sync — ALL active clients (config/clients.json).
 *
 * Same logic as tests/lead-source-sync.spec.ts (shared via lib/leadProcessor.ts,
 * lib/saAutomation.ts, and lib/mapping.ts), looped over every client marked
 * active in config/clients.json. Each client:
 *   - gets its own fresh browser context (no shared cookies/session — SA
 *     logins are per-client, and mixing sessions would be a real risk).
 *   - pulls WhatConverts leads via the shared API key, resolving its
 *     profile_id from its account_id (config only stores account_id).
 *   - applies its own mapping rules from config/clients/<key>.json.
 *   - if a single LEAD errors (e.g. a transient net::ERR_ABORTED navigation —
 *     confirmed live partway through a 90-lead run), that lead is logged and
 *     the client's remaining leads still get processed (lib/leadProcessor.ts
 *     retries the flaky step a few times first).
 *   - if a client's run throws before/outside the per-lead loop (bad login,
 *     WhatConverts error, etc.), the error is recorded and the batch
 *     continues to the next client rather than aborting the whole run.
 *
 * ONE combined summary email is sent at the end covering every client.
 *
 * Usage:
 *   npx playwright test multi-client-sync                # yesterday, all active clients
 *   START_DATE=2026-06-01 END_DATE=2026-06-30 npx playwright test multi-client-sync
 *   CLIENT_KEY=pro_outdoor_llc npx playwright test multi-client-sync   # just one client
 */

test.setTimeout(2 * 60 * 60 * 1000); // generous — this walks 10 clients x many leads each

test('sync SA lead sources for all active clients', async ({ browser }) => {
  const range = resolveDateRange();
  const clients = loadActiveClients();
  const wcCreds = apiCredentials();
  console.log(`Multi-client sync for ${clients.length} active clients, ${range.start} to ${range.end}`);

  const results: ClientRunResult[] = [];

  for (const client of clients) {
    await test.step(client.wc_account_name, async () => {
      // Fresh, isolated context per client — no cookie/session bleed between
      // different clients' SA accounts on the same domain.
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        const mapping = loadClientMapping(client);
        const login = loadSaLogin(client);
        const profileId = await resolveProfileId(wcCreds, client.wc_account_id);

        const leads = await fetchQuotableLeads(range, wcCreds, profileId);
        console.log(`  [${client.wc_account_name}] ${leads.length} unique, quotable leads (profile ${profileId})`);

        await loginToSA(page, process.env.BASE_URL || 'https://my.serviceautopilot.com/', login.email, login.password);

        const stats: RunStats = { updated: [], notFound: [], unmatched: [], errored: [] };

        for (const lead of leads) {
          await test.step(`${lead.contact_name} (${lead.lead_type}, ${lead.lead_source}/${lead.lead_medium})`, async () => {
            await processLead(page, lead, mapping, stats);
          });
        }

        console.log(
          `  [${client.wc_account_name}] Updated: ${stats.updated.length} | Not found: ${stats.notFound.length} | ` +
            `Unmatched: ${stats.unmatched.length} | Errored: ${stats.errored.length}`,
        );
        results.push({ clientName: client.wc_account_name, stats });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [${client.wc_account_name}] FAILED: ${message}`);
        results.push({ clientName: client.wc_account_name, error: message });
      } finally {
        await context.close();
      }
    });
  }

  await sendMultiClientSummaryEmail(results, range);
});
