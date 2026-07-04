import * as fs from 'fs';
import * as path from 'path';
import type { ClientMappingConfig } from './mapping';

export interface ClientEntry {
  key: string;
  wc_account_id: string;
  wc_account_name: string;
  mapping_file: string;
  active: boolean;
}

interface ClientsRegistry {
  clients: ClientEntry[];
}

const REGISTRY_PATH = path.join(__dirname, '..', 'config', 'clients.json');

/**
 * Loads config/clients.json and returns only the active clients.
 * Set CLIENT_KEY in .env (or on the command line) to restrict a run to a
 * single client by its "key" — useful for verifying one client's mapping
 * and SA login before trusting it in a full batch run.
 */
export function loadActiveClients(): ClientEntry[] {
  const registry: ClientsRegistry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  const active = registry.clients.filter((c) => c.active);

  const onlyKey = process.env.CLIENT_KEY;
  if (!onlyKey) return active;

  const filtered = active.filter((c) => c.key === onlyKey);
  if (filtered.length === 0) {
    throw new Error(`CLIENT_KEY="${onlyKey}" did not match any active client key in config/clients.json`);
  }
  return filtered;
}

/** Loads a client's UTM -> SA source mapping rules from its config file. */
export function loadClientMapping(client: ClientEntry): ClientMappingConfig {
  const filePath = path.join(__dirname, '..', client.mapping_file);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export interface SaLogin {
  email: string;
  password: string;
}

/** Reads SA_EMAIL_<KEY> / SA_PASSWORD_<KEY> for a client from .env. */
export function loadSaLogin(client: ClientEntry): SaLogin {
  const envKey = client.key.toUpperCase();
  const email = process.env[`SA_EMAIL_${envKey}`];
  const password = process.env[`SA_PASSWORD_${envKey}`];
  if (!email || !password) {
    throw new Error(`Missing SA_EMAIL_${envKey} / SA_PASSWORD_${envKey} in .env`);
  }
  return { email, password };
}
