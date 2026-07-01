/**
 * Default browser origins for the merged marketing + app (local) and legacy plain localhost.
 * Override with CORS_ORIGIN (comma-separated). FRONTEND_URL / INVITE_BASE_URL for link targets.
 */
export const DEFAULT_FRONTEND_BASE_URL = 'http://app.localhost:3000';
export const DEFAULT_CORS_ORIGINS =
  'http://app.localhost:3000,http://localhost:3000';

export function parseCorsOriginsList(
  env: string | undefined | null,
): string[] {
  const raw = (env ?? DEFAULT_CORS_ORIGINS).trim() || DEFAULT_CORS_ORIGINS;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
