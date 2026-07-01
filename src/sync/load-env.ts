import { config } from 'dotenv';

let loaded = false;

/** Load `.env.development` then `.env` (same order as `main.ts`). Safe to call multiple times. */
export function loadSyncEnv(): void {
  if (loaded) return;
  config({ path: '.env.development' });
  config({ path: '.env', override: true });
  loaded = true;
}
