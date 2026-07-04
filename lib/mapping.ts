import type { WhatConvertsLead } from './whatconverts';

/**
 * Generic per-client UTM source/medium -> Service Autopilot lead-source
 * resolver. Each client's rules live in config/clients/<key>.json (schema
 * documented in config/clients/CLIENT_TEMPLATE.md) rather than in code, so
 * adding a new client or tweaking a mapping never requires touching this file.
 */
export interface WildcardRule {
  if_medium: string;
  if_source_matches_pattern: string;
  then_source: string;
}

export interface ClientMappingConfig {
  combined_mapping: Record<string, string>;
  _wildcard_rules?: WildcardRule[];
  _direct_sources?: string[];
  fallback: string;
}

export type Resolution =
  | { action: 'set'; value: string; reason: string }
  | { action: 'leave'; reason: string }
  | { action: 'direct-fallback'; fallback: string; reason: string } // caller must check live SA value
  | { action: 'unmatched'; reason: string };

// Lowercase + trim only — combined_mapping keys intentionally keep internal
// spaces (e.g. "facebook ads|cpc", "direct visit") as literal, distinct keys.
// WhatConverts sometimes wraps sentinel values in parens (e.g. medium
// "(none)" instead of "none" — confirmed live: this caused a real lead to go
// unmatched against a config that only listed "gmb|none"), so strip a single
// pair of wrapping parens before comparing.
function normalize(s: string | undefined | null): string {
  const trimmed = (s ?? '').toLowerCase().trim();
  const parenMatch = trimmed.match(/^\((.*)\)$/);
  return parenMatch ? parenMatch[1] : trimmed;
}

function lookupTable(source: string, medium: string, config: ClientMappingConfig): Resolution {
  const s = normalize(source);
  const m = normalize(medium);
  const key = `${s}|${m}`;

  const mapped = config.combined_mapping[key];
  if (mapped) return { action: 'set', value: mapped, reason: `matched rule "${key}"` };

  for (const rule of config._wildcard_rules ?? []) {
    if (normalize(rule.if_medium) !== m) continue;
    if (new RegExp(rule.if_source_matches_pattern, 'i').test(s)) {
      return { action: 'set', value: rule.then_source, reason: `wildcard rule "${rule.if_source_matches_pattern}" (medium=${rule.if_medium})` };
    }
  }

  return { action: 'unmatched', reason: `no rule for source="${source}" medium="${medium}"` };
}

/**
 * Resolves the target SA source for a lead against a specific client's
 * mapping config.
 *
 * Direct/none handling: check the WhatConverts customer_journey for an
 * earlier real touchpoint. If one exists, map THAT source/medium instead
 * (recursively). If the journey shows nothing else, this is genuinely direct
 * — return 'direct-fallback' so the caller can decide based on the SA
 * record's CURRENT source value (leave if already set, else use the
 * client's configured fallback).
 */
export function resolveSaSource(lead: WhatConvertsLead, config: ClientMappingConfig): Resolution {
  const { lead_source, lead_medium } = lead;
  const directSources = new Set((config._direct_sources ?? []).map(normalize));

  if (directSources.has(normalize(lead_source))) {
    const earlierAttribution = (lead.customer_journey ?? []).find(
      (entry) =>
        entry.type === 'attribution' &&
        entry.lead_source &&
        !directSources.has(normalize(entry.lead_source)),
    );

    if (earlierAttribution) {
      return lookupTable(earlierAttribution.lead_source!, earlierAttribution.lead_medium ?? '', config);
    }

    return { action: 'direct-fallback', fallback: config.fallback, reason: 'direct/none with no other journey touchpoint' };
  }

  return lookupTable(lead_source, lead_medium, config);
}
