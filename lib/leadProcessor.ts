import { Page } from '@playwright/test';
import type { WhatConvertsLead } from './whatconverts';
import type { ClientMappingConfig } from './mapping';
import { resolveSaSource } from './mapping';
import { RunStats } from './mailer';
import { withRetry } from './retry';
import {
  findClientRecords,
  openEditSalesTab,
  getCurrentSource,
  setSourceAndSave,
  cancelEdit,
} from './saAutomation';

/**
 * Processes one WhatConverts lead end-to-end: find it in SA, resolve its
 * target source, apply the update, record the outcome in `stats`.
 *
 * Wrapped in try/catch per lead (not just per client) — a single transient
 * browser/navigation hiccup (confirmed live: an occasional net::ERR_ABORTED
 * partway through a 90-lead run) must not sacrifice every remaining lead for
 * that client. The SA navigation itself also gets a few retries first, since
 * that's the one flaky step that isn't a real "can't find" or "can't map"
 * business outcome.
 */
export async function processLead(page: Page, lead: WhatConvertsLead, mapping: ClientMappingConfig, stats: RunStats) {
  try {
    const records = await withRetry(() => findClientRecords(page, lead));

    if (records.length === 0) {
      stats.notFound.push({
        name: lead.contact_name,
        phone: lead.phone_number,
        email: lead.email_address,
        leadType: lead.lead_type,
      });
      return;
    }

    const resolution = resolveSaSource(lead, mapping);

    if (resolution.action === 'unmatched') {
      stats.unmatched.push({ name: lead.contact_name, source: lead.lead_source, medium: lead.lead_medium });
      return;
    }

    // Apply to every matching record — duplicates in SA get updated together (client decision).
    for (const record of records) {
      await withRetry(async () => {
        await openEditSalesTab(page, record.href);
        const current = await getCurrentSource(page);

        if (resolution.action === 'leave') {
          await cancelEdit(page);
        } else if (resolution.action === 'direct-fallback') {
          if (current.trim() === '') {
            await setSourceAndSave(page, resolution.fallback);
            stats.updated.push({ name: lead.contact_name, source: resolution.fallback, phone: lead.phone_number, email: lead.email_address });
          } else {
            await cancelEdit(page);
          }
        } else if (resolution.action === 'set') {
          if (current !== resolution.value) {
            await setSourceAndSave(page, resolution.value);
            stats.updated.push({ name: lead.contact_name, source: resolution.value, phone: lead.phone_number, email: lead.email_address });
          } else {
            await cancelEdit(page);
          }
        }
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stats.errored.push({ name: lead.contact_name, error: message });
  }
}
