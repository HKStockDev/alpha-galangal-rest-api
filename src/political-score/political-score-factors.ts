/** Pure helpers for political trade scoring (Formulas.md). Kept separate for clarity and testing. */

export const PS_WEIGHTS = {
  committee: 0.35,
  size: 0.2,
  recency: 0.2,
  influence: 0.15,
  cluster: 0.1,
} as const;

/** Weights for blending per-trade factor scores (defaults match PS_WEIGHTS). */
export type PoliticalTradeWeights = {
  committee: number;
  size: number;
  recency: number;
  influence: number;
  cluster: number;
};

export const POLITICAL_WINDOW_DAYS = 180;
export const CLUSTER_WINDOW_DAYS = 90;

export type CommitteeRole =
  | 'chair'
  | 'ranking_member'
  | 'vice_chair'
  | 'member'
  | 'ex_officio'
  | 'other';

/** Map US session start (UTC date) to Congress number — extend as needed. */
function congressAtOrBefore(isoDate: string): number {
  const t = Date.parse(`${isoDate}T12:00:00.000Z`);
  const sessions: { start: number; congress: number }[] = [
    { start: Date.parse('2025-01-03T12:00:00.000Z'), congress: 119 },
    { start: Date.parse('2023-01-03T12:00:00.000Z'), congress: 118 },
    { start: Date.parse('2021-01-03T12:00:00.000Z'), congress: 117 },
    { start: Date.parse('2019-01-03T12:00:00.000Z'), congress: 116 },
    { start: Date.parse('2017-01-03T12:00:00.000Z'), congress: 115 },
  ];
  for (const s of sessions) {
    if (t >= s.start) return s.congress;
  }
  return 114;
}

export function congressNumberForTradeDate(isoDate: string): number {
  return congressAtOrBefore(isoDate);
}

export function tradeSizeScore(valueUsd: number | null): number {
  if (valueUsd == null || !Number.isFinite(valueUsd) || valueUsd <= 0) return 20;
  if (valueUsd < 15_000) return 20;
  if (valueUsd < 50_000) return 40;
  if (valueUsd < 100_000) return 60;
  if (valueUsd < 250_000) return 80;
  return 100;
}

export function recencyScore(tradeIsoDate: string, asOf: Date): number {
  const trade = Date.parse(`${tradeIsoDate}T12:00:00.000Z`);
  if (!Number.isFinite(trade)) return 0;
  const days = Math.floor((asOf.getTime() - trade) / 86400000);
  if (days <= 30) return 100;
  if (days <= 60) return 80;
  if (days <= 90) return 60;
  if (days <= 120) return 40;
  if (days <= 180) return 20;
  return 0;
}

export function clusterScore(uniquePoliticians: number): number {
  const n = Math.max(1, uniquePoliticians);
  if (n >= 5) return 100;
  if (n === 4) return 80;
  if (n === 3) return 60;
  if (n === 2) return 40;
  return 20;
}

export function influenceScore(role: CommitteeRole | null | undefined): number {
  switch (role) {
    case 'chair':
      return 100;
    case 'ranking_member':
      return 85;
    case 'vice_chair':
      return 70;
    case 'member':
      return 55;
    case 'ex_officio':
      return 50;
    case 'other':
    default:
      return 40;
  }
}

/** Max influence across committee roles (single best title). */
export function maxInfluenceScore(roles: (CommitteeRole | null | undefined)[]): number {
  if (!roles.length) return 40;
  return Math.max(...roles.map((r) => influenceScore(r ?? 'other')));
}

export interface CommitteeSectorRule {
  committeeNamePattern: RegExp;
  sectorPattern: RegExp;
  score: number;
}

/** Default keyword rules: committee name × issuer sector/industry text (max over committees, then max over rules). */
export const DEFAULT_COMMITTEE_SECTOR_RULES: CommitteeSectorRule[] = [
  {
    committeeNamePattern: /armed services|national security/i,
    sectorPattern: /aerospace|defense|weapon|military|space/i,
    score: 100,
  },
  {
    committeeNamePattern: /banking|housing|urban affairs/i,
    sectorPattern: /bank|financial|insurance|capital markets|mortgage|credit/i,
    score: 100,
  },
  {
    committeeNamePattern: /health|aging|help/i,
    sectorPattern: /health|pharma|biotech|medical|drug|hospital/i,
    score: 100,
  },
  {
    committeeNamePattern: /energy|natural resources/i,
    sectorPattern: /energy|oil|gas|petrol|utility|renewable|coal|solar|wind/i,
    score: 100,
  },
  {
    committeeNamePattern: /commerce|science|transport/i,
    sectorPattern: /tech|software|semiconductor|internet|telecom|media|auto|airline|rail/i,
    score: 85,
  },
  {
    committeeNamePattern: /agriculture|nutrition|forestry/i,
    sectorPattern: /agricult|food|fertilizer|crop|meat|packaged food/i,
    score: 100,
  },
  {
    committeeNamePattern: /judiciary|ethics/i,
    sectorPattern: /legal|court|compliance/i,
    score: 50,
  },
];

export function committeeRelevanceScore(
  sectorIndustryText: string,
  committeeNames: string[],
  rules: CommitteeSectorRule[] = DEFAULT_COMMITTEE_SECTOR_RULES,
): number {
  const sector = sectorIndustryText.toLowerCase();
  if (!committeeNames.length) return 0;
  let best = 0;
  for (const cname of committeeNames) {
    for (const r of rules) {
      if (r.committeeNamePattern.test(cname) && r.sectorPattern.test(sector)) {
        if (r.score > best) best = r.score;
      }
    }
  }
  return best;
}

/**
 * Formulas.md: committee–sector match, else weak relevance when we have no committee names
 * in DB (missing bioguide/pcm sync) but sector text still matches a rule — capped at 25 (weak).
 * When committee names exist but none match the sector, returns 0.
 */
export function committeeRelevanceForTrade(
  sectorIndustryText: string,
  committeeNames: string[],
  rules: CommitteeSectorRule[] = DEFAULT_COMMITTEE_SECTOR_RULES,
): number {
  const direct = committeeRelevanceScore(sectorIndustryText, committeeNames, rules);
  if (direct > 0) return direct;
  if (committeeNames.length > 0) return 0;
  const sector = sectorIndustryText.toLowerCase();
  let weak = 0;
  for (const r of rules) {
    if (r.sectorPattern.test(sector)) weak = Math.max(weak, 25);
  }
  return weak;
}

export function tradeScoreFromFactors(
  committee: number,
  size: number,
  recency: number,
  influence: number,
  cluster: number,
  weights: PoliticalTradeWeights = PS_WEIGHTS,
): number {
  const s =
    weights.committee * committee +
    weights.size * size +
    weights.recency * recency +
    weights.influence * influence +
    weights.cluster * cluster;
  return Math.max(0, Math.min(100, s));
}

export function politicalScoreFromPressures(buyPressure: number, sellPressure: number): number {
  const b = Math.max(0, buyPressure);
  const s = Math.max(0, sellPressure);
  const raw = (100 * (b - s)) / (b + s + 1);
  return Math.max(-100, Math.min(100, raw));
}

export function parseUsdMidpoint(raw: unknown): { mid: number | null; low: number | null; high: number | null } {
  if (raw == null) return { mid: null, low: null, high: null };
  const str = String(raw).trim();
  const nums = str.match(/[\d,]+(?:\.\d+)?/g);
  if (!nums?.length) return { mid: null, low: null, high: null };
  const values = nums
    .map((n) => parseFloat(n.replace(/,/g, '')))
    .filter((x) => Number.isFinite(x));
  if (values.length === 0) return { mid: null, low: null, high: null };
  if (values.length === 1) {
    const v = values[0]!;
    return { mid: v, low: v, high: v };
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return { mid: (lo + hi) / 2, low: lo, high: hi };
}

export function parseTradeSide(raw: unknown): 'buy' | 'sell' | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/purchase|buy|acquisition/i.test(s)) return 'buy';
  if (/sale|sell|partial/i.test(s)) return 'sell';
  return null;
}

/** Normalize FMP senate-latest / house-latest transaction date to YYYY-MM-DD. */
export function parseFmpTransactionDate(row: Record<string, unknown>): string | null {
  const raw =
    row.transactionDate ??
    row.date ??
    row.transactionDateFormatted ??
    row.transaction_date;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  const mIso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mIso) return mIso[1]!;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const mm = us[1]!.padStart(2, '0');
    const dd = us[2]!.padStart(2, '0');
    return `${us[3]}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

export function canonicalPersonKey(fullName: string): string {
  const parts = fullName
    .toLowerCase()
    .replace(/,/g, ' ')
    .match(/[a-z]+/g);
  if (!parts?.length) return '';
  return [...parts].sort().join(' ');
}

/** Like canonicalPersonKey but drops 1-letter tokens (initials) so "John A Smith" can match "John Smith". */
export function canonicalPersonKeyRelaxed(fullName: string): string {
  const parts = fullName
    .toLowerCase()
    .replace(/,/g, ' ')
    .match(/[a-z]+/g);
  if (!parts?.length) return '';
  const filtered = parts.filter((p) => p.length > 1);
  const use = filtered.length ? filtered : parts;
  return [...use].sort().join(' ');
}
