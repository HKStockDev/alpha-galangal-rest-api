/**
 * Picks which Meta (Facebook / Instagram Graph) app credentials to load.
 *
 * - **Development profile** (default for `nest start` / local): `META_*_DEVELOPMENT` env vars.
 * - **Production profile** (`VERCEL=1` or `NODE_ENV=production`): `META_*_PRODUCTION` env vars.
 *
 * Override anytime: `META_CREDENTIALS_PROFILE=development` | `production`
 * (e.g. Vercel preview using the dev Meta app).
 */
export function useProductionMetaAppCredentials(): boolean {
  const raw = process.env.META_CREDENTIALS_PROFILE?.trim().toLowerCase();
  if (raw === 'production') {
    return true;
  }
  if (raw === 'development') {
    return false;
  }
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}
