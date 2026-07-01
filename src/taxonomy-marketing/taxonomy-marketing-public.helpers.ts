import { stripLinearTicketRefs } from '../common/strip-linear-ticket-refs';
import {
  applyPublicTickerLimit,
  resolvePublicTickerLimit,
  type PublicHubCurrentRelease,
  type PublicReleaseRow,
  type ReleaseRowLike,
} from '../formula-marketing/formula-marketing-public.helpers';

function publicText(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return null;
  return stripLinearTicketRefs(String(value));
}

export type { PublicReleaseRow, PublicHubCurrentRelease };

export type PublicTaxonomyLibraryItem = {
  marketing_slug: string;
  name: string;
  description: string | null;
  hero_image_url: string | null;
  category?: string | null;
  group?: string | null;
  polarity?: number | null;
  security_count: number;
};

export type PublicTaxonomyHub = {
  marketing_slug: string;
  id: string;
  name: string;
  slug: string;
  description: string | null;
  hero_image_url: string | null;
  marketing_settings: Record<string, unknown>;
  category?: string | null;
  group?: string | null;
  polarity?: number | null;
  current_release: PublicHubCurrentRelease | null;
  past_releases: [];
  next_release_at: null;
};

export type TaxonomyAssignmentRowLike = {
  rank: number | null;
  score: number;
  ticker: string | null;
  entity_name: string | null;
};

export function mapAssignmentToPublicRow(row: TaxonomyAssignmentRowLike): PublicReleaseRow {
  return {
    ticker: row.ticker?.trim() || '—',
    name: row.entity_name,
    rank: row.rank,
    score: Number.isFinite(row.score) ? row.score : null,
    explanation: null,
  };
}

export function rankAssignmentRows<T extends { score: number; ticker: string | null }>(
  rows: T[],
): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.ticker?.trim().toLowerCase() ?? '';
    const bt = b.ticker?.trim().toLowerCase() ?? '';
    return at.localeCompare(bt);
  });
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildCurrentReleaseFromAssignments(input: {
  id: string;
  asOfDate: string;
  marketingSettings: Record<string, unknown> | null | undefined;
  assignments: TaxonomyAssignmentRowLike[];
}): PublicHubCurrentRelease | null {
  if (input.assignments.length === 0) {
    return null;
  }
  const limit = resolvePublicTickerLimit(input.marketingSettings ?? {});
  const releaseRows: ReleaseRowLike[] = input.assignments.map((row) => ({
    rank: row.rank,
    score: row.score,
    ticker: row.ticker,
    entity_name: row.entity_name,
    explanation: null,
  }));
  const { rows, total_row_count } = applyPublicTickerLimit(releaseRows, limit, false);
  const asOfIso = `${input.asOfDate}T00:00:00.000Z`;
  return {
    id: input.id,
    title: 'Current assignments',
    published_at: asOfIso,
    as_of: asOfIso,
    rows,
    total_row_count,
  };
}

export function toPublicExposureHub(input: {
  exposure: Record<string, unknown>;
  marketingSlug: string;
  asOfDate: string | null;
  assignments: TaxonomyAssignmentRowLike[];
}): PublicTaxonomyHub {
  const marketingSettings =
    (input.exposure.marketing_settings as Record<string, unknown> | null | undefined) ?? {};
  const asOfDate = input.asOfDate ?? new Date().toISOString().slice(0, 10);
  const current_release = buildCurrentReleaseFromAssignments({
    id: String(input.exposure.exposure_id),
    asOfDate,
    marketingSettings,
    assignments: input.assignments,
  });

  return {
    marketing_slug: input.marketingSlug,
    id: String(input.exposure.exposure_id),
    slug: String(input.exposure.slug ?? ''),
    name: String(input.exposure.name ?? ''),
    description: publicText(input.exposure.description),
    hero_image_url:
      input.exposure.hero_image_url != null && String(input.exposure.hero_image_url).trim() !== ''
        ? String(input.exposure.hero_image_url)
        : null,
    marketing_settings: marketingSettings,
    category:
      input.exposure.category != null && String(input.exposure.category).trim() !== ''
        ? String(input.exposure.category)
        : null,
    polarity:
      typeof input.exposure.polarity === 'number' && Number.isFinite(input.exposure.polarity)
        ? input.exposure.polarity
        : null,
    current_release,
    past_releases: [],
    next_release_at: null,
  };
}

export function toPublicTagHub(input: {
  tag: Record<string, unknown>;
  marketingSlug: string;
  asOfDate: string | null;
  assignments: TaxonomyAssignmentRowLike[];
}): PublicTaxonomyHub {
  const marketingSettings =
    (input.tag.marketing_settings as Record<string, unknown> | null | undefined) ?? {};
  const asOfDate = input.asOfDate ?? new Date().toISOString().slice(0, 10);
  const current_release = buildCurrentReleaseFromAssignments({
    id: String(input.tag.tag_id),
    asOfDate,
    marketingSettings,
    assignments: input.assignments,
  });

  return {
    marketing_slug: input.marketingSlug,
    id: String(input.tag.tag_id),
    slug: String(input.tag.slug ?? ''),
    name: String(input.tag.name ?? ''),
    description: publicText(input.tag.description),
    hero_image_url:
      input.tag.hero_image_url != null && String(input.tag.hero_image_url).trim() !== ''
        ? String(input.tag.hero_image_url)
        : null,
    marketing_settings: marketingSettings,
    group:
      input.tag.group != null && String(input.tag.group).trim() !== ''
        ? String(input.tag.group)
        : null,
    current_release,
    past_releases: [],
    next_release_at: null,
  };
}

export function toPublicTaxonomyLibraryItem(input: {
  row: Record<string, unknown>;
  marketingSlug: string;
  securityCount: number;
  kind: 'exposure' | 'tag';
}): PublicTaxonomyLibraryItem {
  const base: PublicTaxonomyLibraryItem = {
    marketing_slug: input.marketingSlug,
    name: String(input.row.name ?? ''),
    description: publicText(input.row.description),
    hero_image_url:
      input.row.hero_image_url != null && String(input.row.hero_image_url).trim() !== ''
        ? String(input.row.hero_image_url)
        : null,
    security_count: input.securityCount,
  };
  if (input.kind === 'exposure') {
    base.category =
      input.row.category != null && String(input.row.category).trim() !== ''
        ? String(input.row.category)
        : null;
    base.polarity =
      typeof input.row.polarity === 'number' && Number.isFinite(input.row.polarity)
        ? input.row.polarity
        : null;
  } else {
    base.group =
      input.row.group != null && String(input.row.group).trim() !== ''
        ? String(input.row.group)
        : null;
  }
  return base;
}
