/**
 * WhatConverts API client — pulls unique, quotable (Yes/Pending) leads for a
 * single company profile, for a given date range.
 *
 * API reference confirmed live against https://app.whatconverts.com/api/v1/leads:
 *  - Auth: HTTP Basic as token:secret.
 *  - duplicate=false -> unique leads only.
 *  - quotable accepts ONE value at a time (yes|no|pending|not_set), so "Yes or
 *    Pending" requires two calls merged + de-duped by lead_id.
 *  - customer_journey=true adds a customer_journey[] array per lead (Elite
 *    plan feature) used for the "direct/none" fallback rule.
 *  - profile_id filters to one client. Our single WHATCONVERTS_API_TOKEN/
 *    SECRET pair is agency-level and works across every client's profile_id
 *    (confirmed live against Pro Outdoor LLC's profile, not just Holmes').
 */

export interface WhatConvertsLead {
  lead_id: number;
  lead_type: string; // "Phone Call" | "Web Form" | "Chat" | ...
  lead_source: string;
  lead_medium: string;
  contact_name: string;
  phone_number: string;
  email_address: string;
  quotable: string;
  customer_journey?: Array<{
    type: 'attribution' | 'lead';
    lead_source?: string;
    lead_medium?: string;
    date_created: string;
  }>;
}

function yesterday(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export interface DateRange {
  start: string;
  end: string;
}

/** Resolves the run's date range: explicit START_DATE/END_DATE env vars win, else "yesterday". */
export function resolveDateRange(): DateRange {
  const start = process.env.START_DATE || yesterday();
  const end = process.env.END_DATE || start;
  return { start, end };
}

export interface WhatConvertsCredentials {
  token: string;
  secret: string;
}

/** The one agency-level WhatConverts key, used by both the single- and multi-client scripts. */
export function apiCredentials(): WhatConvertsCredentials {
  const { WHATCONVERTS_API_TOKEN, WHATCONVERTS_API_SECRET } = process.env;
  if (!WHATCONVERTS_API_TOKEN || !WHATCONVERTS_API_SECRET) {
    throw new Error('Missing WHATCONVERTS_API_TOKEN / WHATCONVERTS_API_SECRET in .env');
  }
  return { token: WHATCONVERTS_API_TOKEN, secret: WHATCONVERTS_API_SECRET };
}

function authHeader(creds: WhatConvertsCredentials): string {
  return 'Basic ' + Buffer.from(`${creds.token}:${creds.secret}`).toString('base64');
}

/**
 * clients.json stores each client's WhatConverts ACCOUNT id, not profile id
 * (confirmed live: Holmes' account_id is 98440, but its profile_id — the
 * value the /leads endpoint actually needs — is 146769). This resolves the
 * profile(s) for an account so callers never have to hardcode profile_id.
 * Returns the first profile found; flags if an account has more than one.
 */
export async function resolveProfileId(creds: WhatConvertsCredentials, accountId: string): Promise<string> {
  const url = new URL(`https://app.whatconverts.com/api/v1/accounts/${accountId}/profiles`);
  const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
  if (!res.ok) {
    throw new Error(`WhatConverts /profiles error ${res.status} for account ${accountId}: ${await res.text()}`);
  }
  const data = await res.json();
  const profiles = data.profiles ?? [];
  if (profiles.length === 0) {
    throw new Error(`No WhatConverts profiles found for account ${accountId}`);
  }
  if (profiles.length > 1) {
    console.warn(
      `Account ${accountId} has ${profiles.length} profiles — using the first (${profiles[0].profile_id}). ` +
        `Set an explicit profile_id in config/clients.json for this client if that's wrong.`,
    );
  }
  return String(profiles[0].profile_id);
}

async function fetchLeadsPage(
  creds: WhatConvertsCredentials,
  profileId: string,
  quotable: 'yes' | 'pending',
  range: DateRange,
  pageNumber: number,
): Promise<{ leads: WhatConvertsLead[]; totalPages: number }> {
  const url = new URL('https://app.whatconverts.com/api/v1/leads');
  url.searchParams.set('start_date', range.start);
  url.searchParams.set('end_date', range.end);
  url.searchParams.set('profile_id', profileId);
  url.searchParams.set('duplicate', 'false');
  url.searchParams.set('quotable', quotable);
  url.searchParams.set('customer_journey', 'true');
  url.searchParams.set('leads_per_page', '2500');
  url.searchParams.set('page_number', String(pageNumber));

  const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
  if (!res.ok) {
    throw new Error(`WhatConverts API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return { leads: data.leads ?? [], totalPages: data.total_pages ?? 1 };
}

/** Pulls all unique, quotable=Yes/Pending leads for the date range, de-duped by lead_id. */
export async function fetchQuotableLeads(
  range: DateRange,
  creds: WhatConvertsCredentials = apiCredentials(),
  profileId: string = process.env.WHATCONVERTS_PROFILE_ID ?? '',
): Promise<WhatConvertsLead[]> {
  if (!profileId) throw new Error('Missing profileId (and no WHATCONVERTS_PROFILE_ID in .env)');

  const byId = new Map<number, WhatConvertsLead>();

  for (const quotable of ['yes', 'pending'] as const) {
    let page = 1;
    while (true) {
      const { leads, totalPages } = await fetchLeadsPage(creds, profileId, quotable, range, page);
      for (const lead of leads) byId.set(lead.lead_id, lead);
      if (page >= totalPages) break;
      page++;
    }
  }

  return [...byId.values()];
}
