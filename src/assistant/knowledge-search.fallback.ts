import {
  KNOWLEDGE_SOURCE_TYPES,
  KnowledgeSourceType,
} from './knowledge-index.service';

export type KnowledgeLiveSourceType = KnowledgeSourceType | 'formula_description';

export type KnowledgeSearchResultWithLive = {
  source_type: KnowledgeLiveSourceType;
  source_id: string;
  organization_client_id: string | null;
  title: string | null;
  snippet: string;
  similarity: number;
  live_fetch?: boolean;
};

export type KnowledgeSearchFallbackMeta = {
  triggered: boolean;
  reason: string;
  live_hits: number;
  sources_queried: string[];
};

const PLACEHOLDER_SNIPPET_RE =
  /\bplaceholder\b|\bsample content\b|Use the admin panel to replace this body/i;

const RELEASE_QUERY_RE = /\breleases?\b/i;

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'with',
  'from',
  'what',
  'which',
  'find',
  'about',
  'have',
  'does',
  'are',
  'our',
  'your',
  'this',
  'those',
  'these',
  'when',
  'where',
  'emphasize',
  'emphasizes',
  'mention',
  'mentions',
]);

export function extractSearchTerms(query: string, maxTerms = 8): string[] {
  const terms = new Set<string>();
  const normalized = query.trim();
  if (normalized.length >= 4) {
    terms.add(normalized.toLowerCase());
  }
  for (const word of normalized.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 3 && !STOP_WORDS.has(word)) {
      terms.add(word);
    }
  }
  return [...terms].slice(0, maxTerms);
}

export function isPlaceholderSnippet(text: string): boolean {
  return PLACEHOLDER_SNIPPET_RE.test(text);
}

export function scoreTermMatches(haystack: string, terms: string[]): number {
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) {
      score += term.includes(' ') ? 3 : 1;
    }
  }
  return score;
}

export function liveSimilarityFromScore(score: number, maxScore: number): number {
  if (score <= 0 || maxScore <= 0) return 0.4;
  const ratio = score / maxScore;
  return Math.min(0.84, 0.42 + ratio * 0.4);
}

export function evaluateSearchQuality(params: {
  results: KnowledgeSearchResultWithLive[];
  query: string;
  sourceTypes: KnowledgeSourceType[] | null;
  minSimilarity: number;
  fallbackEnabled: boolean;
}): { needsFallback: boolean; reason: string } {
  if (!params.fallbackEnabled) {
    return { needsFallback: false, reason: '' };
  }

  const { results, query, sourceTypes, minSimilarity } = params;

  if (results.length === 0) {
    return { needsFallback: true, reason: 'no_results' };
  }

  const topSimilarity = Math.max(...results.map((row) => row.similarity));
  if (topSimilarity < minSimilarity) {
    return { needsFallback: true, reason: 'low_similarity' };
  }

  const substantive = results.filter((row) => !isPlaceholderSnippet(row.snippet));
  if (substantive.length === 0) {
    return { needsFallback: true, reason: 'all_placeholders' };
  }

  const wantsReleases =
    RELEASE_QUERY_RE.test(query) &&
    (!sourceTypes || sourceTypes.includes('formula_release_body'));
  if (wantsReleases) {
    const hasSubstantiveRelease = results.some(
      (row) =>
        row.source_type === 'formula_release_body' && !isPlaceholderSnippet(row.snippet),
    );
    if (!hasSubstantiveRelease) {
      return { needsFallback: true, reason: 'release_query_no_substantive_release_hits' };
    }
  }

  return { needsFallback: false, reason: '' };
}

export function mergeSearchResults(
  primary: KnowledgeSearchResultWithLive[],
  supplemental: KnowledgeSearchResultWithLive[],
  limit: number,
): KnowledgeSearchResultWithLive[] {
  const seen = new Set(primary.map((row) => `${row.source_type}:${row.source_id}`));
  const merged = [...primary];
  for (const row of supplemental) {
    const key = `${row.source_type}:${row.source_id}`;
    if (seen.has(key)) continue;
    merged.push(row);
    seen.add(key);
    if (merged.length >= limit) break;
  }
  return merged.slice(0, limit);
}

export function allowsSourceType(
  sourceTypes: KnowledgeSourceType[] | null,
  sourceType: KnowledgeLiveSourceType,
): boolean {
  if (!sourceTypes || sourceTypes.length === 0) return true;
  if (sourceType === 'formula_description') {
    return sourceTypes.includes('formula_release_body');
  }
  return (KNOWLEDGE_SOURCE_TYPES as readonly string[]).includes(sourceType);
}
