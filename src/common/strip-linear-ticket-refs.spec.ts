import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripLinearTicketRefs } from './strip-linear-ticket-refs';

describe('stripLinearTicketRefs', () => {
  it('removes leading CON ticket prefix', () => {
    assert.equal(
      stripLinearTicketRefs(
        'CON-190: LLM-scored alignment with U.S. economy, workforce, industrial base, and strategic interests.',
      ),
      'LLM-scored alignment with U.S. economy, workforce, industrial base, and strategic interests.',
    );
  });

  it('removes leading SKE ticket prefix', () => {
    assert.equal(
      stripLinearTicketRefs(
        'SKE-36: Insider conviction from Form 4-style flows — open-market buys/sells, roles, recency, clustering, cap normalization (Formulas.md).',
      ),
      'Insider conviction from Form 4-style flows — open-market buys/sells, roles, recency, clustering, cap normalization (Formulas.md).',
    );
  });

  it('removes parenthetical ticket references', () => {
    assert.equal(
      stripLinearTicketRefs('Open-market buys and sells, roles, recency, and clustering (SKE-36).'),
      'Open-market buys and sells, roles, recency, and clustering.',
    );
  });

  it('removes parenthetical ticket references with extra detail', () => {
    assert.equal(
      stripLinearTicketRefs(
        'Classifies a single news or event item into public.market_content / public.market_content_entities (CON-53 DDL in this migration).',
      ),
      'Classifies a single news or event item into public.market_content / public.market_content_entities.',
    );
  });

  it('removes inline parenthetical references in body copy', () => {
    assert.equal(
      stripLinearTicketRefs(
        'The **Insider Conviction Score** (SKE-36) analyzes Form 4-style flows.',
      ),
      'The **Insider Conviction Score** analyzes Form 4-style flows.',
    );
  });

  it('returns null for empty input', () => {
    assert.equal(stripLinearTicketRefs(null), null);
    assert.equal(stripLinearTicketRefs('   '), null);
  });
});
