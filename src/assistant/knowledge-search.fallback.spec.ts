import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateSearchQuality,
  extractSearchTerms,
  isPlaceholderSnippet,
  mergeSearchResults,
  scoreTermMatches,
} from './knowledge-search.fallback';

describe('knowledge-search.fallback helpers', () => {
  it('extracts meaningful search terms', () => {
    const terms = extractSearchTerms('Find releases that emphasize capital preservation');
    assert.ok(terms.includes('capital'));
    assert.ok(terms.includes('preservation'));
    assert.ok(terms.includes('find releases that emphasize capital preservation'));
  });

  it('detects placeholder snippets', () => {
    assert.equal(
      isPlaceholderSnippet('This is placeholder marketing copy for the formula.'),
      true,
    );
    assert.equal(
      isPlaceholderSnippet('Conservative risk profile with liquidity needs.'),
      false,
    );
  });

  it('scores term matches with phrase boost', () => {
    const score = scoreTermMatches('capital preservation and low volatility', [
      'capital preservation',
      'volatility',
    ]);
    assert.ok(score >= 4);
  });

  it('requests fallback when all hits are placeholders', () => {
    const result = evaluateSearchQuality({
      fallbackEnabled: true,
      minSimilarity: 0.55,
      query: 'Find releases that emphasize capital preservation',
      sourceTypes: null,
      results: [
        {
          source_type: 'formula_release_body',
          source_id: 'r1',
          organization_client_id: null,
          title: 'Sample',
          snippet: 'This is placeholder marketing copy. Use the admin panel.',
          similarity: 0.72,
        },
      ],
    });
    assert.equal(result.needsFallback, true);
    assert.equal(result.reason, 'all_placeholders');
  });

  it('merges supplemental results without duplicates', () => {
    const merged = mergeSearchResults(
      [
        {
          source_type: 'chat_message',
          source_id: 'm1',
          organization_client_id: null,
          title: 'user message',
          snippet: 'prior question',
          similarity: 0.9,
        },
      ],
      [
        {
          source_type: 'formula_description',
          source_id: 'f1',
          organization_client_id: null,
          title: 'Hedge Fund Risk',
          snippet: 'Risk-adjusted score favoring lower volatility.',
          similarity: 0.7,
          live_fetch: true,
        },
      ],
      5,
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[1].source_type, 'formula_description');
  });
});
