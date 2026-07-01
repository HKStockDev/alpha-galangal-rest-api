import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildIlikeOrFilter,
  emptySearchResponse,
  escapeIlikePattern,
  normalizeSearchQuery,
  rankStocksForSearch,
  resolveSearchLimit,
} from './marketing-search-public.helpers';

describe('escapeIlikePattern', () => {
  it('escapes ilike wildcards', () => {
    assert.equal(escapeIlikePattern('100%_'), '100\\%\\_');
  });
});

describe('normalizeSearchQuery', () => {
  it('returns null for short queries', () => {
    assert.equal(normalizeSearchQuery('a'), null);
    assert.equal(normalizeSearchQuery('  '), null);
  });

  it('trims valid queries', () => {
    assert.equal(normalizeSearchQuery('  buffett  '), 'buffett');
  });
});

describe('resolveSearchLimit', () => {
  it('defaults to 5 and caps at 10', () => {
    assert.equal(resolveSearchLimit(undefined), 5);
    assert.equal(resolveSearchLimit('99'), 10);
    assert.equal(resolveSearchLimit(3), 3);
  });
});

describe('buildIlikeOrFilter', () => {
  it('builds postgrest or filter', () => {
    assert.equal(
      buildIlikeOrFilter(['name', 'ticker'], 'aa'),
      'name.ilike.%aa%,ticker.ilike.%aa%',
    );
  });
});

describe('rankStocksForSearch', () => {
  it('prefers ticker prefix matches', () => {
    const ranked = rankStocksForSearch(
      [
        { id: '1', ticker: 'BA', name: 'Boeing' },
        { id: '2', ticker: 'AAPL', name: 'Apple' },
        { id: '3', ticker: 'ABNB', name: 'Airbnb' },
      ],
      'aa',
    );
    assert.deepEqual(
      ranked.map((r) => r.ticker),
      ['AAPL', 'ABNB', 'BA'],
    );
  });
});

describe('emptySearchResponse', () => {
  it('returns empty groups', () => {
    const res = emptySearchResponse();
    assert.deepEqual(res.formulas, []);
    assert.deepEqual(res.stocks, []);
  });
});
