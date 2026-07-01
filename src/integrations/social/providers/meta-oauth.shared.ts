import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { OAuthTokenResponse } from '../interfaces/social-oauth-provider.interface';

export type MetaAppCredentials = { appId: string; appSecret: string; scope: string };

export type MetaDiscoveredAccount = {
  platform: 'facebook' | 'instagram';
  externalAccountId: string;
  accountLabel: string;
  externalAccountName: string | null;
  accessToken: string;
  metadata?: Record<string, unknown>;
};

export function metaGraphVersion(config: ConfigService): string {
  const raw = config.get<string>('social.meta.graphApiVersion')?.trim() || 'v21.0';
  return raw.startsWith('v') ? raw : `v${raw}`;
}

export function metaGraphBase(config: ConfigService): string {
  return `https://graph.facebook.com/${metaGraphVersion(config)}`;
}

export function metaDialogUrl(config: ConfigService): string {
  return `https://www.facebook.com/${metaGraphVersion(config)}/dialog/oauth`;
}

export function requireMetaApp(config: ConfigService, defaultScopes: string): MetaAppCredentials {
  const appId = config.get<string>('social.meta.appId')?.trim();
  const appSecret = config.get<string>('social.meta.appSecret')?.trim();
  const scopesRaw = config.get<string>('social.meta.scopes')?.trim();
  const scope = scopesRaw || defaultScopes;
  if (!appId || !appSecret) {
    throw new ServiceUnavailableException(
      'Meta OAuth is not configured. Set META_APP_ID_DEVELOPMENT + META_APP_SECRET_DEVELOPMENT (+ META_CALLBACK_URL_DEVELOPMENT) for local API, or the _PRODUCTION variants on Vercel / NODE_ENV=production.',
    );
  }
  return { appId, appSecret, scope };
}

export function parseMetaJson(
  logger: Logger,
  text: string,
  status: number,
  ctx: string,
): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    logger.warn(`${ctx} non-JSON status=${status} body=${text.slice(0, 300)}`);
    throw new ServiceUnavailableException(`${ctx} returned an invalid response.`);
  }
}

export function throwMetaGraphError(
  logger: Logger,
  status: number,
  json: Record<string, unknown>,
  text: string,
  ctx: string,
): never {
  const err = json.error as Record<string, unknown> | string | undefined;
  let msg = '';
  if (err && typeof err === 'object') {
    msg =
      (typeof err.message === 'string' ? err.message : '') ||
      (typeof err.error_user_msg === 'string' ? err.error_user_msg : '');
  }
  if (!msg && typeof json.error_description === 'string') {
    msg = json.error_description;
  }
  if (!msg) {
    msg = text.slice(0, 200);
  }
  logger.warn(`${ctx} failed status=${status} body=${text.slice(0, 500)}`);
  throw new ServiceUnavailableException(`${ctx} failed (${status}): ${msg || 'unknown error'}`);
}

export async function exchangeMetaCodeForUserToken(
  config: ConfigService,
  logger: Logger,
  code: string,
  redirectUri: string,
): Promise<OAuthTokenResponse> {
  const { appId, appSecret } = requireMetaApp(
    config,
    'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts',
  );
  const shortLived = await fetchMetaAccessTokenFromCode(config, logger, appId, appSecret, code, redirectUri);
  try {
    const longLived = await exchangeMetaForLongLivedUserToken(config, logger, appId, appSecret, shortLived.access_token);
    return {
      access_token: longLived.access_token,
      expires_in: longLived.expires_in,
      refresh_token: longLived.access_token,
      scope: shortLived.scope,
    };
  } catch (e) {
    logger.warn(
      `Meta long-lived exchange failed; using short-lived token: ${e instanceof Error ? e.message : String(e)}`,
    );
    return {
      access_token: shortLived.access_token,
      expires_in: shortLived.expires_in,
      refresh_token: shortLived.access_token,
      scope: shortLived.scope,
    };
  }
}

export async function refreshMetaUserToken(
  config: ConfigService,
  logger: Logger,
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const { appId, appSecret } = requireMetaApp(
    config,
    'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts',
  );
  return exchangeMetaForLongLivedUserToken(config, logger, appId, appSecret, refreshToken);
}

async function fetchMetaAccessTokenFromCode(
  config: ConfigService,
  logger: Logger,
  appId: string,
  appSecret: string,
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; expires_in: number; scope?: string }> {
  const u = new URL(`${metaGraphBase(config)}/oauth/access_token`);
  u.searchParams.set('client_id', appId);
  u.searchParams.set('client_secret', appSecret);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('code', code);
  const res = await fetch(u.toString(), { method: 'GET' });
  const text = await res.text();
  const json = parseMetaJson(logger, text, res.status, 'Meta code exchange');
  if (!res.ok) {
    throwMetaGraphError(logger, res.status, json, text, 'Meta code exchange');
  }
  const access_token = json.access_token as string | undefined;
  const expires_in = Number(json.expires_in ?? 7200);
  if (!access_token || !Number.isFinite(expires_in)) {
    throw new ServiceUnavailableException('Meta token response missing access_token or expires_in.');
  }
  return {
    access_token,
    expires_in,
    scope: typeof json.scope === 'string' ? json.scope : undefined,
  };
}

async function exchangeMetaForLongLivedUserToken(
  config: ConfigService,
  logger: Logger,
  appId: string,
  appSecret: string,
  shortOrLongLivedUserToken: string,
): Promise<OAuthTokenResponse> {
  const u = new URL(`${metaGraphBase(config)}/oauth/access_token`);
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', appId);
  u.searchParams.set('client_secret', appSecret);
  u.searchParams.set('fb_exchange_token', shortOrLongLivedUserToken);
  const res = await fetch(u.toString(), { method: 'GET' });
  const text = await res.text();
  const json = parseMetaJson(logger, text, res.status, 'Meta long-lived exchange');
  if (!res.ok) {
    throwMetaGraphError(logger, res.status, json, text, 'Meta long-lived exchange');
  }
  const access_token = json.access_token as string | undefined;
  const expiresRaw = json.expires_in;
  const n = Number(typeof expiresRaw === 'number' || typeof expiresRaw === 'string' ? expiresRaw : NaN);
  const expires_in = Number.isFinite(n) && n > 0 ? n : 5184000;
  if (!access_token || !Number.isFinite(expires_in)) {
    throw new ServiceUnavailableException('Meta long-lived response missing access_token or expires_in.');
  }
  return {
    access_token,
    expires_in,
    refresh_token: access_token,
    scope: typeof json.scope === 'string' ? json.scope : undefined,
  };
}

export async function discoverMetaPageAccounts(
  config: ConfigService,
  logger: Logger,
  userAccessToken: string,
  mode: 'facebook' | 'instagram' | 'all',
): Promise<MetaDiscoveredAccount[]> {
  const u = new URL(`${metaGraphBase(config)}/me/accounts`);
  u.searchParams.set(
    'fields',
    'id,name,access_token,instagram_business_account{id,username,name}',
  );
  u.searchParams.set('access_token', userAccessToken);
  const res = await fetch(u.toString(), { method: 'GET' });
  const text = await res.text();
  const json = parseMetaJson(logger, text, res.status, 'Meta /me/accounts');
  if (!res.ok) {
    throwMetaGraphError(logger, res.status, json, text, 'Meta /me/accounts');
  }
  const data = Array.isArray(json.data) ? json.data : [];
  const out: MetaDiscoveredAccount[] = [];

  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const page = row as Record<string, unknown>;
    const pageId = typeof page.id === 'string' ? page.id : null;
    const pageName = typeof page.name === 'string' ? page.name : null;
    const pageToken = typeof page.access_token === 'string' ? page.access_token : null;
    if (!pageId || !pageToken) continue;

    if (mode === 'facebook' || mode === 'all') {
      out.push({
        platform: 'facebook',
        externalAccountId: pageId,
        accountLabel: pageName?.trim() || `Facebook Page ${pageId}`,
        externalAccountName: pageName,
        accessToken: pageToken,
        metadata: { meta_page_id: pageId, meta_resource_type: 'page' },
      });
    }

    const ig = page.instagram_business_account as Record<string, unknown> | undefined;
    if (ig && (mode === 'instagram' || mode === 'all')) {
      const igId = typeof ig.id === 'string' ? ig.id : null;
      if (!igId) continue;
      const igUser = typeof ig.username === 'string' ? ig.username : null;
      const igName = typeof ig.name === 'string' ? ig.name : igUser;
      out.push({
        platform: 'instagram',
        externalAccountId: igId,
        accountLabel: igUser ? `@${igUser}` : `Instagram ${igId}`,
        externalAccountName: igName,
        accessToken: pageToken,
        metadata: {
          meta_page_id: pageId,
          meta_ig_business_id: igId,
          meta_ig_username: igUser,
          meta_resource_type: 'instagram_business',
        },
      });
    }
  }

  return out;
}
