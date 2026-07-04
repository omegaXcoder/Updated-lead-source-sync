import nodemailer from 'nodemailer';

export interface RunStats {
  updated: Array<{ name: string; source: string; phone?: string; email?: string }>;
  notFound: Array<{ name: string; phone: string; email: string; leadType: string }>;
  unmatched: Array<{ name: string; source: string; medium: string }>;
  errored: Array<{ name: string; error: string }>;
}

export interface ClientRunResult {
  clientName: string;
  stats?: RunStats;
  error?: string; // set instead of stats if the client's run threw (e.g. bad login)
}

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !SMTP_TO) {
    throw new Error('Missing SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM/SMTP_TO in .env');
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return { transporter, from: SMTP_FROM, to: SMTP_TO };
}

function statsLines(stats: RunStats): string[] {
  const lines: string[] = [];
  lines.push(`Updated: ${stats.updated.length}`);
  lines.push(`Not found: ${stats.notFound.length}`);
  lines.push(`Unmatched UTM combos: ${stats.unmatched.length}`, '');

  if (stats.updated.length) {
    lines.push(`CLIENTS UPDATED (${stats.updated.length}):`);
    for (const c of stats.updated) {
      const contact = c.phone || c.email ? ` (${c.phone || ''}${c.phone && c.email ? ' / ' : ''}${c.email || ''})` : '';
      lines.push(`  - ${c.name}${contact} -> ${c.source}`);
    }
    lines.push('');
  }

  if (stats.notFound.length) {
    lines.push(`NOT FOUND IN SERVICE AUTOPILOT (${stats.notFound.length}):`);
    for (const c of stats.notFound) {
      lines.push(`  - ${c.name} | ${c.leadType} | phone: ${c.phone || '-'} | email: ${c.email || '-'}`);
    }
    lines.push('');
  }

  if (stats.unmatched.length) {
    lines.push(`UNMATCHED UTM SOURCE/MEDIUM — NEEDS A MAPPING ADDED (${stats.unmatched.length}):`);
    for (const c of stats.unmatched) {
      lines.push(`  - ${c.name} | source: "${c.source}" | medium: "${c.medium}"`);
    }
    lines.push('');
  }

  if (stats.errored.length) {
    lines.push(`ERRORED (browser/navigation failure — retry manually) (${stats.errored.length}):`);
    for (const c of stats.errored) {
      lines.push(`  - ${c.name} | ${c.error}`);
    }
  }

  return lines;
}

/** Sends the one summary email per run for a single client. */
export async function sendRunSummaryEmail(stats: RunStats, range: { start: string; end: string }) {
  const { transporter, from, to } = getTransporter();

  const lines = [`SA Lead Source Sync — summary for ${range.start} to ${range.end}`, '', ...statsLines(stats)];

  await transporter.sendMail({
    from,
    to,
    subject:
      `SA Lead Source Sync — ${stats.updated.length} updated, ${stats.notFound.length} not found, ` +
      `${stats.unmatched.length} unmatched, ${stats.errored.length} errored (${range.start})`,
    text: lines.join('\n'),
  });

  console.log(`Summary email sent to ${to}`);
}

/** Sends ONE combined email covering every client processed in a multi-client batch run. */
export async function sendMultiClientSummaryEmail(
  results: ClientRunResult[],
  range: { start: string; end: string },
) {
  const { transporter, from, to } = getTransporter();

  const totals = results.reduce(
    (acc, r) => {
      if (r.stats) {
        acc.updated += r.stats.updated.length;
        acc.notFound += r.stats.notFound.length;
        acc.unmatched += r.stats.unmatched.length;
        acc.errored += r.stats.errored.length;
      } else {
        acc.failed += 1;
      }
      return acc;
    },
    { updated: 0, notFound: 0, unmatched: 0, errored: 0, failed: 0 },
  );

  const lines: string[] = [];
  lines.push(`SA Lead Source Sync — multi-client summary for ${range.start} to ${range.end}`, '');
  lines.push(
    `Totals across ${results.length} clients: ${totals.updated} updated, ${totals.notFound} not found, ` +
      `${totals.unmatched} unmatched, ${totals.errored} errored, ${totals.failed} client(s) failed to run`,
    '',
    '='.repeat(60),
  );

  for (const result of results) {
    lines.push('', result.clientName, '-'.repeat(result.clientName.length));
    if (result.error) {
      lines.push(`FAILED: ${result.error}`);
      continue;
    }
    lines.push(...statsLines(result.stats!));
  }

  await transporter.sendMail({
    from,
    to,
    subject:
      `SA Lead Source Sync (${results.length} clients) — ${totals.updated} updated, ${totals.notFound} not found, ` +
      `${totals.unmatched} unmatched, ${totals.errored} errored, ${totals.failed} failed (${range.start})`,
    text: lines.join('\n'),
  });

  console.log(`Multi-client summary email sent to ${to}`);
}
