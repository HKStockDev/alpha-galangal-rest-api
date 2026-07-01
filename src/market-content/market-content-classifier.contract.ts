/**
 * Contract for LLM output of the market content classifier (CON-84 shape).
 *
 * CON-53 mapping (see `20260421140000_seed_market_content_classifier_prompt_con83.sql` DDL from Docs/events_news.sql.txt):
 *
 * - `market_content.*` (except `raw`) -> columns on `public.market_content`. `raw` is filled by ingestion from the provider payload.
 * - `source` and `content_type` are NOT NULL in Postgres; the LLM must return non-empty strings.
 * - Each `market_content_entities[]` element -> one `public.market_content_entities` row after resolving
 *   `entity_identifier` (from CON-85 candidate list) to `public.entities.id` for `entity_id`.
 * - Enforce at most one `is_primary: true` per content item (recommended; matches ingestion expectations).
 */

export interface MarketContentPayload {
  source: string;
  content_type: string;
  category: string | null;
  title: string | null;
  summary: string | null;
  url: string | null;
  published_at: string | null;
  occurred_at: string | null;
}

export interface MarketContentEntityPayload {
  entity_identifier: string;
  is_primary: boolean;
  polarity: -1 | 0 | 1 | null;
  severity: number | null;
  confidence: number | null;
  should_display: boolean;
  display_reason: string | null;
  materiality_score: number | null;
}

export interface MarketContentClassifierOutput {
  market_content: MarketContentPayload;
  market_content_entities: MarketContentEntityPayload[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function validateMarketContentClassifierOutput(
  raw: unknown,
): { ok: true; value: MarketContentClassifierOutput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ['Root must be a JSON object'] };
  }
  const mc = raw.market_content;
  const mce = raw.market_content_entities;
  if (!isRecord(mc)) {
    errors.push('market_content must be an object');
  }
  if (!Array.isArray(mce)) {
    errors.push('market_content_entities must be an array');
  } else if (mce.length < 1) {
    errors.push('market_content_entities must contain at least one entity');
  }

  if (errors.length) return { ok: false, errors };

  const content = mc as Record<string, unknown>;
  const stringOrNull = (v: unknown, field: string): string | null => {
    if (v === null) return null;
    if (typeof v === 'string') return v;
    errors.push(`${field} must be a string or null`);
    return null;
  };

  const categoryRaw = content.category;
  let category: string | null = null;
  if (categoryRaw === null || categoryRaw === undefined) {
    category = null;
  } else if (typeof categoryRaw === 'string') {
    category = categoryRaw.trim() || null;
  } else {
    errors.push('market_content.category must be a string or null');
  }

  if (typeof content.source !== 'string' || content.source.trim() === '') {
    errors.push('market_content.source must be a non-empty string');
  }
  if (typeof content.content_type !== 'string' || content.content_type.trim() === '') {
    errors.push('market_content.content_type must be a non-empty string');
  }

  const market_content: MarketContentPayload = {
    source: typeof content.source === 'string' ? content.source : '',
    content_type: typeof content.content_type === 'string' ? content.content_type : '',
    category,
    title: stringOrNull(content.title, 'market_content.title'),
    summary: stringOrNull(content.summary, 'market_content.summary'),
    url: stringOrNull(content.url, 'market_content.url'),
    published_at: stringOrNull(content.published_at, 'market_content.published_at'),
    occurred_at: stringOrNull(content.occurred_at, 'market_content.occurred_at'),
  };

  const entities: MarketContentEntityPayload[] = [];
  let primaryCount = 0;
  for (let i = 0; i < (mce as unknown[]).length; i++) {
    const row = (mce as unknown[])[i];
    const errBefore = errors.length;
    if (!isRecord(row)) {
      errors.push(`market_content_entities[${i}] must be an object`);
      continue;
    }
    if (typeof row.entity_identifier !== 'string' || row.entity_identifier.length === 0) {
      errors.push(`market_content_entities[${i}].entity_identifier must be a non-empty string`);
    }
    if (typeof row.is_primary !== 'boolean') {
      errors.push(`market_content_entities[${i}].is_primary must be a boolean`);
    }
    const pol = row.polarity;
    if (pol !== null && pol !== -1 && pol !== 0 && pol !== 1) {
      errors.push(`market_content_entities[${i}].polarity must be -1, 0, 1, or null`);
    }
    for (const key of ['severity', 'confidence', 'materiality_score'] as const) {
      const v = row[key];
      if (v !== null && typeof v !== 'number') {
        errors.push(`market_content_entities[${i}].${key} must be a number or null`);
      }
    }
    if (typeof row.should_display !== 'boolean') {
      errors.push(`market_content_entities[${i}].should_display must be a boolean`);
    }
    if (row.display_reason !== null && row.display_reason !== undefined && typeof row.display_reason !== 'string') {
      errors.push(`market_content_entities[${i}].display_reason must be a string or null`);
    }
    if (errors.length > errBefore) continue;
    if (row.is_primary) primaryCount += 1;
    entities.push({
      entity_identifier: row.entity_identifier as string,
      is_primary: row.is_primary as boolean,
      polarity: pol as -1 | 0 | 1 | null,
      severity: row.severity as number | null,
      confidence: row.confidence as number | null,
      should_display: row.should_display as boolean,
      display_reason:
        row.display_reason === undefined || row.display_reason === null
          ? null
          : (row.display_reason as string),
      materiality_score: row.materiality_score as number | null,
    });
  }

  if (primaryCount > 1) {
    errors.push('At most one market_content_entities item may have is_primary true');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: { market_content, market_content_entities: entities },
  };
}
