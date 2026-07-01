import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCurrentReleaseFromAssignments,
  rankAssignmentRows,
  toPublicExposureHub,
  toPublicTagHub,
  toPublicTaxonomyLibraryItem,
} from './taxonomy-marketing-public.helpers';

describe('rankAssignmentRows', () => {
  it('ranks by score desc then ticker', () => {
    const ranked = rankAssignmentRows([
      { score: 0.5, ticker: 'ZZZ' },
      { score: 0.9, ticker: 'AAA' },
      { score: 0.9, ticker: 'BBB' },
    ]);
    assert.deepEqual(
      ranked.map((r) => r.ticker),
      ['AAA', 'BBB', 'ZZZ'],
    );
    assert.deepEqual(
      ranked.map((r) => r.rank),
      [1, 2, 3],
    );
  });
});

describe('buildCurrentReleaseFromAssignments', () => {
  it('caps rows using public_ticker_limit from marketing settings', () => {
    const release = buildCurrentReleaseFromAssignments({
      id: 'exp-1',
      asOfDate: '2026-06-01',
      marketingSettings: { public_ticker_limit: 2 },
      assignments: [
        { rank: 1, score: 0.9, ticker: 'AAPL', entity_name: 'Apple' },
        { rank: 2, score: 0.8, ticker: 'MSFT', entity_name: 'Microsoft' },
        { rank: 3, score: 0.7, ticker: 'GOOG', entity_name: 'Alphabet' },
      ],
    });
    assert.equal(release?.rows.length, 2);
    assert.equal(release?.total_row_count, 3);
    assert.equal(release?.title, 'Current assignments');
  });

  it('returns null when no assignments', () => {
    assert.equal(
      buildCurrentReleaseFromAssignments({
        id: 'exp-1',
        asOfDate: '2026-06-01',
        marketingSettings: {},
        assignments: [],
      }),
      null,
    );
  });
});

describe('toPublicExposureHub', () => {
  it('builds hub with category and polarity', () => {
    const hub = toPublicExposureHub({
      exposure: {
        exposure_id: 'e-1',
        name: 'AI Infrastructure',
        slug: 'ai-infrastructure',
        category: 'macro',
        description: 'Exposure to AI buildout',
        polarity: 1,
        marketing_settings: { cta_key: 'Create Account', public_ticker_limit: 5 },
      },
      marketingSlug: 'ai-infrastructure',
      asOfDate: '2026-06-01',
      assignments: [{ rank: 1, score: 0.95, ticker: 'NVDA', entity_name: 'NVIDIA' }],
    });
    assert.equal(hub.marketing_slug, 'ai-infrastructure');
    assert.equal(hub.category, 'macro');
    assert.equal(hub.polarity, 1);
    assert.equal(hub.current_release?.rows.length, 1);
    assert.deepEqual(hub.past_releases, []);
  });
});

describe('toPublicTagHub', () => {
  it('builds hub with group', () => {
    const hub = toPublicTagHub({
      tag: {
        tag_id: 't-1',
        name: 'Dividend Aristocrat',
        slug: 'dividend-aristocrat',
        group: 'style',
        description: 'Long dividend history',
        marketing_settings: { public_ticker_limit: 5 },
      },
      marketingSlug: 'dividend-aristocrat',
      asOfDate: '2026-06-01',
      assignments: [{ rank: 1, score: 0.88, ticker: 'KO', entity_name: 'Coca-Cola' }],
    });
    assert.equal(hub.group, 'style');
    assert.equal(hub.current_release?.rows[0]?.ticker, 'KO');
  });
});

describe('toPublicTaxonomyLibraryItem', () => {
  it('maps exposure library card fields', () => {
    const item = toPublicTaxonomyLibraryItem({
      row: {
        name: 'Rates Sensitivity',
        description: 'Rate exposure',
        category: 'macro',
        hero_image_url: 'https://example.com/hero.png',
      },
      marketingSlug: 'rates-sensitivity',
      securityCount: 42,
      kind: 'exposure',
    });
    assert.equal(item.marketing_slug, 'rates-sensitivity');
    assert.equal(item.security_count, 42);
    assert.equal(item.category, 'macro');
  });
});
