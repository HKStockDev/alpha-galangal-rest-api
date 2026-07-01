import { stripLinearTicketRefs } from '../common/strip-linear-ticket-refs';

function publicText(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return null;
  return stripLinearTicketRefs(String(value));
}

export type PublicMarketingSearchFormula = {
  marketing_slug: string;
  name: string;
  description: string | null;
};

export type PublicMarketingSearchExposure = {
  marketing_slug: string;
  name: string;
  description: string | null;
  category: string | null;
};

export type PublicMarketingSearchTag = {
  marketing_slug: string;
  name: string;
  description: string | null;
  group: string | null;
};

export type PublicMarketingSearchStock = {
  id: string;
  ticker: string;
  name: string;
};

export type PublicMarketingSearchResponse = {
  formulas: PublicMarketingSearchFormula[];
  exposures: PublicMarketingSearchExposure[];
  tags: PublicMarketingSearchTag[];
  stocks: PublicMarketingSearchStock[];
};

export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 10;
export const MIN_SEARCH_QUERY_LENGTH = 2;

export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function normalizeSearchQuery(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) return null;
  return trimmed;
}

export function resolveSearchLimit(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SEARCH_LIMIT;
  return Math.min(MAX_SEARCH_LIMIT, Math.floor(n));
}

export function emptySearchResponse(): PublicMarketingSearchResponse {
  return { formulas: [], exposures: [], tags: [], stocks: [] };
}

export function buildIlikeOrFilter(fields: string[], escapedQuery: string): string {
  const pattern = `%${escapedQuery}%`;
  return fields.map((field) => `${field}.ilike.${pattern}`).join(',');
}

export function mapFormulaRow(row: Record<string, unknown>): PublicMarketingSearchFormula | null {
  const marketingSlug =
    typeof row.marketing_slug === 'string' && row.marketing_slug.trim()
      ? row.marketing_slug.trim().toLowerCase()
      : null;
  if (!marketingSlug) return null;
  return {
    marketing_slug: marketingSlug,
    name: String(row.name ?? ''),
    description: publicText(row.description),
  };
}

export function mapExposureRow(row: Record<string, unknown>): PublicMarketingSearchExposure | null {
  const marketingSlug =
    typeof row.marketing_slug === 'string' && row.marketing_slug.trim()
      ? row.marketing_slug.trim().toLowerCase()
      : null;
  if (!marketingSlug) return null;
  return {
    marketing_slug: marketingSlug,
    name: String(row.name ?? ''),
    description: publicText(row.description),
    category:
      row.category != null && String(row.category).trim() !== ''
        ? String(row.category)
        : null,
  };
}

export function mapTagRow(row: Record<string, unknown>): PublicMarketingSearchTag | null {
  const marketingSlug =
    typeof row.marketing_slug === 'string' && row.marketing_slug.trim()
      ? row.marketing_slug.trim().toLowerCase()
      : null;
  if (!marketingSlug) return null;
  return {
    marketing_slug: marketingSlug,
    name: String(row.name ?? ''),
    description: publicText(row.description),
    group:
      row.group != null && String(row.group).trim() !== ''
        ? String(row.group)
        : null,
  };
}

export function mapStockRow(row: Record<string, unknown>): PublicMarketingSearchStock | null {
  const id = row.id != null ? String(row.id) : null;
  const ticker = typeof row.ticker === 'string' ? row.ticker.trim() : null;
  if (!id || !ticker) return null;
  return {
    id,
    ticker,
    name: String(row.name ?? ''),
  };
}

export function rankStocksForSearch(
  rows: PublicMarketingSearchStock[],
  query: string,
): PublicMarketingSearchStock[] {
  const q = query.trim().toLowerCase();
  return [...rows].sort((a, b) => {
    const at = a.ticker.toLowerCase();
    const bt = b.ticker.toLowerCase();
    const aPrefix = at.startsWith(q) ? 0 : 1;
    const bPrefix = bt.startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    if (at !== bt) return at.localeCompare(bt);
    return a.name.localeCompare(b.name);
  });
}
