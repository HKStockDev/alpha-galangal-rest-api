import { stripLinearTicketRefs } from '../common/strip-linear-ticket-refs';

function publicText(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return null;
  return stripLinearTicketRefs(String(value));
}

export type PublicReleaseRow = {
  ticker: string;
  name: string | null;
  rank: number | null;
  score: number | null;
  explanation: string | null;
};

export type PublicHubPastRelease = {
  slug: string;
  title: string;
  published_at: string;
  as_of: string;
};

export type PublicHubCurrentRelease = {
  id: string;
  slug?: string;
  title?: string | null;
  published_at: string;
  as_of: string;
  rows: PublicReleaseRow[];
  total_row_count: number;
};

export type PublicMarketingHub = {
  marketing_slug: string;
  name: string;
  key: string;
  id: string;
  hero_image_url: string | null;
  description: string | null;
  display_formula: string | null;
  marketing_settings: Record<string, unknown>;
  next_release_at: string | null;
  current_release: PublicHubCurrentRelease | null;
  past_releases: PublicHubPastRelease[];
};

export type PublicMarketingReleasePage = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  hero_image_url: string | null;
  as_of: string;
  published_at: string;
  settings_json: Record<string, unknown> | null;
  rows: PublicReleaseRow[];
  total_row_count: number;
  parent_formula: {
    name: string;
    key: string;
    description: string | null;
    marketing_slug: string | null;
  } | null;
};

export type ReleaseRowLike = {
  rank: number | null;
  score: number;
  ticker: string | null;
  entity_name: string | null;
  explanation: Record<string, unknown> | null;
};

export type PublishedReleaseLike = {
  id: string;
  slug: string;
  title: string;
  published_at: string | null;
  as_of: string;
  is_published: boolean;
};

const DEFAULT_PUBLIC_TICKER_LIMIT = 5;

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function resolvePublicTickerLimit(
  formulaSettings: Record<string, unknown> | null | undefined,
  releaseSettings?: Record<string, unknown> | null,
): number {
  const fromRelease = coerceNumber(releaseSettings?.public_ticker_limit);
  if (fromRelease != null && fromRelease > 0) {
    return Math.floor(fromRelease);
  }
  const fromFormula = coerceNumber(formulaSettings?.public_ticker_limit);
  if (fromFormula != null && fromFormula > 0) {
    return Math.floor(fromFormula);
  }
  return DEFAULT_PUBLIC_TICKER_LIMIT;
}

export function formatPublicExplanation(
  explanation: Record<string, unknown> | null | undefined,
): string | null {
  if (!explanation || Object.keys(explanation).length === 0) return null;
  if (typeof explanation.commentary === 'string' && explanation.commentary.trim()) {
    return explanation.commentary.trim();
  }
  if (typeof explanation.summary === 'string' && explanation.summary.trim()) {
    return explanation.summary.trim();
  }
  return null;
}

export function mapReleaseRowToPublic(row: ReleaseRowLike, includeExplanation: boolean): PublicReleaseRow {
  const ticker = row.ticker?.trim() || '—';
  return {
    ticker,
    name: row.entity_name,
    rank: row.rank,
    score: Number.isFinite(row.score) ? row.score : null,
    explanation: includeExplanation ? formatPublicExplanation(row.explanation) : null,
  };
}

export function sortReleaseRows<T extends ReleaseRowLike>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ar = a.rank;
    const br = b.rank;
    if (ar != null && br != null) return ar - br;
    if (ar != null) return -1;
    if (br != null) return 1;
    return b.score - a.score;
  });
}

export function applyPublicTickerLimit<T extends ReleaseRowLike>(
  rows: T[],
  limit: number,
  includeExplanation = false,
): { rows: PublicReleaseRow[]; total_row_count: number } {
  const sorted = sortReleaseRows(rows);
  const total_row_count = sorted.length;
  const capped = sorted.slice(0, Math.max(0, limit));
  return {
    rows: capped.map((row) => mapReleaseRowToPublic(row, includeExplanation)),
    total_row_count,
  };
}

export function pickCurrentPublishedReleaseId(
  releases: PublishedReleaseLike[],
): string | null {
  const published = releases.filter(
    (r) => r.is_published && r.published_at != null && String(r.published_at).trim() !== '',
  );
  if (published.length === 0) return null;
  const sorted = [...published].sort((a, b) => {
    const at = Date.parse(String(a.published_at));
    const bt = Date.parse(String(b.published_at));
    return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
  });
  return String(sorted[0]!.id);
}

export function buildPastReleases(
  releases: PublishedReleaseLike[],
  currentReleaseId: string | null,
): PublicHubPastRelease[] {
  return releases
    .filter(
      (r) =>
        r.is_published &&
        r.published_at != null &&
        String(r.published_at).trim() !== '' &&
        String(r.id) !== currentReleaseId,
    )
    .sort((a, b) => Date.parse(String(b.published_at)) - Date.parse(String(a.published_at)))
    .map((r) => ({
      slug: r.slug,
      title: r.title,
      published_at: String(r.published_at),
      as_of: String(r.as_of),
    }));
}

export function toPublicReleasePage(
  release: Record<string, unknown>,
  formula: Record<string, unknown>,
  rows: ReleaseRowLike[],
): PublicMarketingReleasePage {
  const formulaSettings =
    (formula.marketing_settings as Record<string, unknown> | null | undefined) ?? {};
  const releaseSettings =
    (release.settings_json as Record<string, unknown> | null | undefined) ?? {};
  const limit = resolvePublicTickerLimit(formulaSettings, releaseSettings);
  const { rows: publicRows, total_row_count } = applyPublicTickerLimit(rows, limit, false);

  return {
    id: String(release.id),
    slug: String(release.slug),
    title: String(release.title ?? ''),
    subtitle: publicText(release.subtitle),
    body: publicText(release.body),
    hero_image_url:
      release.hero_image_url != null && String(release.hero_image_url).trim() !== ''
        ? String(release.hero_image_url)
        : null,
    as_of: String(release.as_of),
    published_at: String(release.published_at ?? release.as_of),
    settings_json: (release.settings_json as Record<string, unknown> | null) ?? null,
    rows: publicRows,
    total_row_count,
    parent_formula: {
      name: String(formula.name ?? ''),
      key: String(formula.key ?? ''),
      description: publicText(formula.description),
      marketing_slug:
        formula.marketing_slug != null && String(formula.marketing_slug).trim() !== ''
          ? String(formula.marketing_slug)
          : null,
    },
  };
}

export function toPublicMarketingHub(input: {
  formula: Record<string, unknown>;
  marketingSlug: string;
  releases: PublishedReleaseLike[];
  currentRelease: Record<string, unknown> | null;
  currentRows: ReleaseRowLike[];
}): PublicMarketingHub {
  const formulaSettings =
    (input.formula.marketing_settings as Record<string, unknown> | null | undefined) ?? {};
  const currentId = input.currentRelease ? String(input.currentRelease.id) : null;
  const releaseSettings = input.currentRelease
    ? ((input.currentRelease.settings_json as Record<string, unknown> | null | undefined) ?? {})
    : {};
  const limit = resolvePublicTickerLimit(formulaSettings, releaseSettings);

  let current_release: PublicHubCurrentRelease | null = null;
  if (input.currentRelease && input.currentRelease.published_at) {
    const { rows, total_row_count } = applyPublicTickerLimit(input.currentRows, limit, false);
    current_release = {
      id: String(input.currentRelease.id),
      slug: String(input.currentRelease.slug),
      title:
        input.currentRelease.title != null ? String(input.currentRelease.title) : null,
      published_at: String(input.currentRelease.published_at),
      as_of: String(input.currentRelease.as_of),
      rows,
      total_row_count,
    };
  }

  return {
    marketing_slug: input.marketingSlug,
    id: String(input.formula.id),
    key: String(input.formula.key ?? ''),
    name: String(input.formula.name ?? ''),
    hero_image_url:
      input.formula.hero_image_url != null && String(input.formula.hero_image_url).trim() !== ''
        ? String(input.formula.hero_image_url)
        : null,
    description: publicText(input.formula.description),
    display_formula:
      input.formula.display_formula != null && String(input.formula.display_formula).trim() !== ''
        ? String(input.formula.display_formula)
        : null,
    marketing_settings: formulaSettings,
    next_release_at:
      input.formula.next_release_at != null ? String(input.formula.next_release_at) : null,
    current_release,
    past_releases: buildPastReleases(input.releases, currentId),
  };
}
