import {
  DEFAULT_CORS_ORIGINS,
  DEFAULT_FRONTEND_BASE_URL,
} from './app-urls';
import { useProductionMetaAppCredentials } from './meta-credentials-profile';

export function normalizeApiGlobalPrefix(raw: string | undefined): string {
  if (raw == null || !String(raw).trim()) {
    return '';
  }
  return String(raw).replace(/^\/+|\/+$/g, '').trim();
}

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export default () => {
  const frontendBase = (
    trimEnv(process.env.FRONTEND_URL) ??
    trimEnv(process.env.INVITE_BASE_URL) ??
    DEFAULT_FRONTEND_BASE_URL
  ).replace(/\/+$/, '');

  return {
  api: {
    /** When set, Nest mounts all routes at /{prefix} (e.g. api → /api/auth/login). */
    globalPrefix: normalizeApiGlobalPrefix(process.env.API_GLOBAL_PREFIX),
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: process.env.SUPABASE_JWT_SECRET,
    /** Supabase Auth "Send email" hook signing secret (v1,whsec_... from dashboard). */
    sendEmailHookSecret: (() => {
      const raw = trimEnv(process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET);
      if (!raw) return undefined;
      return raw.replace(/^v1,whsec_/, '');
    })(),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  assistant: {
    embeddingModel: trimEnv(process.env.ASSISTANT_EMBEDDING_MODEL) ?? 'gemini-embedding-001',
    knowledgeSearchTopK: (() => {
      const n = Number.parseInt(process.env.ASSISTANT_KNOWLEDGE_SEARCH_TOP_K ?? '8', 10);
      return Number.isFinite(n) && n > 0 ? n : 8;
    })(),
    knowledgeIndexEnabled:
      process.env.ASSISTANT_KNOWLEDGE_INDEX_ENABLED == null ||
      process.env.ASSISTANT_KNOWLEDGE_INDEX_ENABLED === '' ||
      process.env.ASSISTANT_KNOWLEDGE_INDEX_ENABLED.toLowerCase() === 'true' ||
      process.env.ASSISTANT_KNOWLEDGE_INDEX_ENABLED === '1',
    knowledgeEmbedBatch: (() => {
      const n = Number.parseInt(process.env.ASSISTANT_KNOWLEDGE_EMBED_BATCH ?? '16', 10);
      return Number.isFinite(n) && n > 0 ? n : 16;
    })(),
    typesenseEnabled:
      process.env.ASSISTANT_TYPESENSE_ENABLED?.toLowerCase() === 'true' ||
      process.env.ASSISTANT_TYPESENSE_ENABLED === '1',
    typesenseHost: trimEnv(process.env.TYPESENSE_HOST),
    typesenseApiKey: trimEnv(process.env.TYPESENSE_API_KEY),
    typesenseCollection:
      trimEnv(process.env.ASSISTANT_TYPESENSE_COLLECTION) ?? 'organization_knowledge_chunks',
    typesenseTimeoutMs: (() => {
      const n = Number.parseInt(process.env.ASSISTANT_TYPESENSE_TIMEOUT_MS ?? '8000', 10);
      return Number.isFinite(n) && n > 0 ? n : 8000;
    })(),
    typesenseSyncLimit: (() => {
      const n = Number.parseInt(process.env.ASSISTANT_TYPESENSE_SYNC_LIMIT ?? '5000', 10);
      return Number.isFinite(n) && n > 0 ? n : 5000;
    })(),
    knowledgeSearchFallbackEnabled:
      process.env.ASSISTANT_KNOWLEDGE_SEARCH_FALLBACK_ENABLED == null ||
      process.env.ASSISTANT_KNOWLEDGE_SEARCH_FALLBACK_ENABLED === '' ||
      process.env.ASSISTANT_KNOWLEDGE_SEARCH_FALLBACK_ENABLED.toLowerCase() === 'true' ||
      process.env.ASSISTANT_KNOWLEDGE_SEARCH_FALLBACK_ENABLED === '1',
    knowledgeSearchMinSimilarity: (() => {
      const n = Number.parseFloat(process.env.ASSISTANT_KNOWLEDGE_SEARCH_MIN_SIMILARITY ?? '0.55');
      return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.55;
    })(),
  },
  fmp: {
    apiKey: process.env.FMP_API_KEY,
    baseUrl: process.env.FMP_API_BASE_URL ?? 'https://financialmodelingprep.com',
  },
  massive: {
    apiKey: process.env.MASSIVE_API_KEY,
    baseUrl: process.env.MASSIVE_API_BASE_URL ?? 'https://api.polygon.io',
  },
  congressGov: {
    apiKey: process.env.CONGRESS_GOV_API_KEY,
    baseUrl: process.env.CONGRESS_GOV_BASE_URL ?? 'https://api.congress.gov',
  },
  apollo: {
    apiKey: process.env.APOLLO_API_KEY,
    baseUrl: process.env.APOLLO_API_BASE_URL ?? 'https://api.apollo.io/api/v1',
  },
  apify: {
    token: process.env.APIFY_API_TOKEN,
    baseUrl: process.env.APIFY_API_BASE_URL ?? 'https://api.apify.com',
    indeedActorId: process.env.APIFY_INDEED_ACTOR_ID ?? 'kaix/indeed-scraper',
    /** https://apify.com/logical_scrapers/linkedin-company-scraper */
    linkedinLogicalCompanyScraperId:
      process.env.APIFY_LINKEDIN_LOGICAL_COMPANY_SCRAPER_ID ?? 'logical_scrapers/linkedin-company-scraper',
    /** https://apify.com/riceman/linkedin-company-data-insights-scraper */
    linkedinRicemanInsightsId:
      process.env.APIFY_LINKEDIN_RICEMAN_INSIGHTS_ID ?? 'riceman/linkedin-company-data-insights-scraper',
    /** https://apify.com/s-r/free-linkedin-company-finder---linkedin-address-from-any-site */
    linkedinCompanyFinderId:
      process.env.APIFY_LINKEDIN_COMPANY_FINDER_ID ??
      's-r/free-linkedin-company-finder---linkedin-address-from-any-site',
  },
  taxonomy: {
    gicsTaxonomyId: process.env.TAXONOMY_ID ?? process.env.GICS_TAXONOMY_ID,
  },
  postgres: {
    projectRef: process.env.SUPABASE_PROJECT_ID,
    password: process.env.POSTGRES_PASSWORD,
  },
  invitations: {
    frontendUrl: frontendBase,
    resendApiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.INVITE_FROM_EMAIL ?? 'alex@withprecision.ai',
  },
  /** Stripe Billing (Checkout, Customer Portal, webhooks). Server-only secrets. */
  stripe: {
    secretKey: trimEnv(process.env.STRIPE_SECRET_KEY),
    webhookSecret: trimEnv(process.env.STRIPE_WEBHOOK_SECRET),
    checkoutSuccessUrl:
      trimEnv(process.env.STRIPE_CHECKOUT_SUCCESS_URL) ?? `${frontendBase}/billing/success`,
    checkoutCancelUrl:
      trimEnv(process.env.STRIPE_CHECKOUT_CANCEL_URL) ?? `${frontendBase}/billing/cancel`,
    billingPortalReturnUrl:
      trimEnv(process.env.STRIPE_BILLING_PORTAL_RETURN_URL) ??
      `${frontendBase}/settings/billing`,
    /** Optional: skip auto-sync; use this Stripe billing_portal.configuration id (bpc_...). */
    billingPortalConfigurationId: trimEnv(process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID),
    /** CON-168: trial length when Checkout is started with start_trial=true. */
    trialDays: parseInt(process.env.STRIPE_TRIAL_DAYS ?? '14', 10),
  },
  port: parseInt(process.env.PORT ?? '3001', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? DEFAULT_CORS_ORIGINS,
  marketing: {
    contactForm: {
      notifyEmail: process.env.CONTACT_FORM_NOTIFY_EMAIL?.trim() || 'alex@withprecision.ai',
    },
  },
  /** In-process Nest cron (empty = job disabled). Standard 5-field cron. */
  dataSync: {
    cronFmpPoliticalTrades: (process.env.DATA_SYNC_CRON_FMP_POLITICAL_TRADES ?? '').trim(),
    /** FMP senate/house symbols missing from `securities` → profile upsert (gap fill). */
    cronFmpPoliticalFeedMissingSecurities: (
      process.env.DATA_SYNC_CRON_FMP_POLITICAL_FEED_MISSING_SECURITIES ?? ''
    ).trim(),
    cronCongressMembers: (process.env.DATA_SYNC_CRON_CONGRESS_MEMBERS ?? '').trim(),
    cronCommitteeMemberships: (process.env.DATA_SYNC_CRON_COMMITTEE_MEMBERSHIPS ?? '').trim(),
    cronTaxonomyStructuralGrowthCagrScores: (
      process.env.DATA_SYNC_CRON_TAXONOMY_STRUCTURAL_GROWTH_CAGR_SCORES ?? ''
    ).trim(),
    /** Weekly (or custom) cron for recomputing security_exposures for all equities. */
    cronEquityExposures: (process.env.DATA_SYNC_CRON_EQUITY_EXPOSURES ?? '').trim(),
    /** Weekly LLM refresh of sector/industry/sub-industry cycle scores (1m/3m/6m/12m/24m) on taxonomy entities. */
    cronTaxonomyCycleScores: (process.env.DATA_SYNC_CRON_TAXONOMY_CYCLE_SCORES ?? '').trim(),
    equityExposuresDelayMs: (() => {
      const n = Number.parseInt(process.env.DATA_SYNC_EQUITY_EXPOSURES_DELAY_MS ?? '400', 10);
      return Number.isFinite(n) && n >= 0 ? n : 400;
    })(),
    taxonomyCycleScoresDelayMs: (() => {
      const n = Number.parseInt(process.env.DATA_SYNC_TAXONOMY_CYCLE_SCORES_DELAY_MS ?? '1500', 10);
      return Number.isFinite(n) && n >= 0 ? n : 1500;
    })(),
  },
  social: {
    /** Default org for Precision-only social OAuth when the client omits organization_id. */
    precisionOrganizationId: process.env.PRECISION_ORGANIZATION_ID?.trim(),
    tokenEncryptionKey: process.env.SOCIAL_TOKEN_ENCRYPTION_KEY?.trim(),
    oauthStateSecret: process.env.SOCIAL_OAUTH_STATE_SECRET?.trim(),
    /**
     * OAuth: `LINKEDIN_CALLBACK_URL` + Meta `META_*_{DEVELOPMENT|PRODUCTION}` (see `meta-credentials-profile.ts`).
     */
    linkedin: {
      clientId: process.env.LINKEDIN_CLIENT_ID?.trim(),
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET?.trim(),
      redirectUri: process.env.LINKEDIN_CALLBACK_URL?.trim(),
      scopes: process.env.LINKEDIN_OAUTH_SCOPES?.trim(),
    },
    /** Meta (Facebook + Instagram Graph). Profile chosen by `useProductionMetaAppCredentials()`. */
    meta: (() => {
      const prod = useProductionMetaAppCredentials();
      const facebookCallback = (
        prod ? process.env.META_CALLBACK_URL_PRODUCTION : process.env.META_CALLBACK_URL_DEVELOPMENT
      )?.trim();
      const instagramCallback = (
        prod
          ? process.env.META_INSTAGRAM_CALLBACK_URL_PRODUCTION
          : process.env.META_INSTAGRAM_CALLBACK_URL_DEVELOPMENT
      )?.trim();
      return {
        credentialsProfile: prod ? ('production' as const) : ('development' as const),
        appId: (prod ? process.env.META_APP_ID_PRODUCTION : process.env.META_APP_ID_DEVELOPMENT)?.trim(),
        appSecret: (prod ? process.env.META_APP_SECRET_PRODUCTION : process.env.META_APP_SECRET_DEVELOPMENT)?.trim(),
        redirectUri: facebookCallback,
        instagramRedirectUri: instagramCallback || facebookCallback,
        graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim(),
        scopes: process.env.META_OAUTH_SCOPES?.trim(),
      };
    })(),
    x: {
      clientId: process.env.X_CLIENT_ID?.trim(),
      clientSecret: process.env.X_CLIENT_SECRET?.trim(),
      redirectUri: process.env.X_CALLBACK_URL?.trim(),
      scopes: process.env.X_OAUTH_SCOPES?.trim(),
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY?.trim(),
      clientSecret: process.env.TIKTOK_CLIENT_SECRET?.trim(),
      redirectUri: process.env.TIKTOK_CALLBACK_URL?.trim(),
      scopes: process.env.TIKTOK_OAUTH_SCOPES?.trim(),
    },
  },
  woopSocial: {
    apiKey: trimEnv(process.env.WOOP_SOCIAL_API_KEY),
    baseUrl: trimEnv(process.env.WOOP_SOCIAL_BASE_URL) ?? 'https://api.woopsocial.com/v1',
    projectId: trimEnv(process.env.WOOP_SOCIAL_PROJECT_ID),
    defaultProjectName: trimEnv(process.env.WOOP_SOCIAL_PROJECT_NAME) ?? 'Precision',
    webhookSigningSecret: trimEnv(process.env.WOOP_WEBHOOK_SIGNING_SECRET),
  },
  };
};
