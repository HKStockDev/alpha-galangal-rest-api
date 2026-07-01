import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPublicTickerLimit,
  buildPastReleases,
  pickCurrentPublishedReleaseId,
  resolvePublicTickerLimit,
  toPublicMarketingHub,
  toPublicReleasePage,
} from './formula-marketing-public.helpers';

describe('resolvePublicTickerLimit', () => {
  it('prefers release settings over formula settings', () => {
    assert.equal(
      resolvePublicTickerLimit({ public_ticker_limit: 5 }, { public_ticker_limit: 3 }),
      3,
    );
  });

  it('defaults to 5', () => {
    assert.equal(resolvePublicTickerLimit(null), 5);
  });
});

describe('applyPublicTickerLimit', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    rank: i + 1,
    score: 100 - i,
    ticker: `T${i + 1}`,
    entity_name: `Name ${i + 1}`,
    explanation: { commentary: `note ${i + 1}` },
  }));

  it('slices rows to the limit and omits explanations', () => {
    const { rows: out, total_row_count } = applyPublicTickerLimit(rows, 5);
    assert.equal(out.length, 5);
    assert.equal(total_row_count, 8);
    assert.equal(out[0]?.ticker, 'T1');
    assert.equal(out[0]?.explanation, null);
  });
});

describe('pickCurrentPublishedReleaseId', () => {
  it('picks latest published release', () => {
    const id = pickCurrentPublishedReleaseId([
      {
        id: 'a',
        slug: 'a',
        title: 'A',
        published_at: '2024-01-01T00:00:00.000Z',
        as_of: '2024-01-01T00:00:00.000Z',
        is_published: true,
      },
      {
        id: 'b',
        slug: 'b',
        title: 'B',
        published_at: '2025-01-01T00:00:00.000Z',
        as_of: '2025-01-01T00:00:00.000Z',
        is_published: true,
      },
    ]);
    assert.equal(id, 'b');
  });
});

describe('buildPastReleases', () => {
  it('excludes current release', () => {
    const past = buildPastReleases(
      [
        {
          id: 'current',
          slug: 'current',
          title: 'Current',
          published_at: '2025-01-01T00:00:00.000Z',
          as_of: '2025-01-01T00:00:00.000Z',
          is_published: true,
        },
        {
          id: 'old',
          slug: 'old',
          title: 'Old',
          published_at: '2024-01-01T00:00:00.000Z',
          as_of: '2024-01-01T00:00:00.000Z',
          is_published: true,
        },
      ],
      'current',
    );
    assert.equal(past.length, 1);
    assert.equal(past[0]?.slug, 'old');
  });
});

describe('toPublicReleasePage', () => {
  it('returns flat release page shape', () => {
    const page = toPublicReleasePage(
      {
        id: 'rel-1',
        slug: 'buffett-score-2025',
        title: 'Buffett picks',
        subtitle: 'Subtitle',
        body: 'Body',
        hero_image_url: null,
        as_of: '2025-01-01T00:00:00.000Z',
        published_at: '2025-01-02T00:00:00.000Z',
        settings_json: { public_ticker_limit: 2 },
      },
      {
        id: 'f-1',
        key: 'alpha_galangal_committee_buffett_score',
        name: 'Buffett Score',
        description: 'Desc',
        marketing_slug: 'buffett-score',
        marketing_settings: { public_ticker_limit: 5 },
      },
      [
        { rank: 1, score: 90, ticker: 'AAPL', entity_name: 'Apple', explanation: { x: 1 } },
        { rank: 2, score: 80, ticker: 'MSFT', entity_name: 'Microsoft', explanation: { x: 2 } },
        { rank: 3, score: 70, ticker: 'LMT', entity_name: 'Lockheed', explanation: { x: 3 } },
      ],
    );
    assert.equal(page.title, 'Buffett picks');
    assert.equal(page.parent_formula?.marketing_slug, 'buffett-score');
    assert.equal(page.rows.length, 2);
    assert.equal(page.total_row_count, 3);
  });
});

describe('toPublicMarketingHub', () => {
  it('strips Linear ticket references from description', () => {
    const hub = toPublicMarketingHub({
      marketingSlug: 'america-first-score',
      formula: {
        id: 'f-1',
        key: 'america_first_score',
        name: 'America First Score',
        description:
          'CON-190: LLM-scored alignment with U.S. economy, workforce, industrial base, and strategic interests.',
        display_formula: 'American Control + Economic Benefit',
        hero_image_url: null,
        marketing_settings: {},
        next_release_at: null,
      },
      releases: [],
      currentRelease: null,
      currentRows: [],
    });
    assert.equal(
      hub.description,
      'LLM-scored alignment with U.S. economy, workforce, industrial base, and strategic interests.',
    );
  });

  it('builds hub with current and past releases', () => {
    const hub = toPublicMarketingHub({
      marketingSlug: 'buffett-score',
      formula: {
        id: 'f-1',
        key: 'alpha_galangal_committee_buffett_score',
        name: 'Buffett Score',
        description: 'Desc',
        display_formula: 'LLM',
        hero_image_url: null,
        marketing_settings: { public_ticker_limit: 1, cta_key: 'Create Account' },
        next_release_at: null,
      },
      releases: [
        {
          id: 'r-new',
          slug: 'buffett-new',
          title: 'New',
          published_at: '2025-02-01T00:00:00.000Z',
          as_of: '2025-02-01T00:00:00.000Z',
          is_published: true,
        },
        {
          id: 'r-old',
          slug: 'buffett-old',
          title: 'Old',
          published_at: '2024-02-01T00:00:00.000Z',
          as_of: '2024-02-01T00:00:00.000Z',
          is_published: true,
        },
      ],
      currentRelease: {
        id: 'r-new',
        slug: 'buffett-new',
        title: 'New',
        published_at: '2025-02-01T00:00:00.000Z',
        as_of: '2025-02-01T00:00:00.000Z',
        settings_json: {},
      },
      currentRows: [
        { rank: 1, score: 90, ticker: 'AAPL', entity_name: 'Apple', explanation: null },
        { rank: 2, score: 80, ticker: 'MSFT', entity_name: 'Microsoft', explanation: null },
      ],
    });
    assert.equal(hub.marketing_slug, 'buffett-score');
    assert.equal(hub.current_release?.slug, 'buffett-new');
    assert.equal(hub.current_release?.rows.length, 1);
    assert.equal(hub.current_release?.total_row_count, 2);
    assert.equal(hub.past_releases.length, 1);
    assert.equal(hub.past_releases[0]?.slug, 'buffett-old');
  });
});
