import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAndNormalizeAmericaFirstPayload,
  recomputeAmericaFirstScore,
} from './america-first-score-payload';

describe('parseAndNormalizeAmericaFirstPayload', () => {
  const basePayload = {
    model: 'america_first',
    score: 85,
    label: 'positive',
    confidence: 0.8,
    american_control: {
      headquarters: 10,
      ceo_us: 10,
      founder_us: 8,
      board_us: 9,
      subtotal: 37,
    },
    american_economic_benefit: {
      workforce: 9,
      manufacturing: 8,
      rd: 7,
      taxes_capex: 6,
      subtotal: 30,
    },
    strategic_importance: {
      defense: 5,
      energy: 3,
      semiconductors_ai: 4,
      critical_infrastructure: 4,
      subtotal: 16,
    },
    penalties: {
      china_manufacturing: 0,
      china_supply_chain: 0,
      foreign_gov_control: 0,
      low_us_workforce: 0,
      adversarial_regulatory: 0,
      total: 0,
    },
    commentary: 'Strong U.S. footprint.',
  };

  it('parses valid JSON and recomputes score from subtotals', () => {
    const result = parseAndNormalizeAmericaFirstPayload(JSON.stringify(basePayload));
    assert.equal(result.score, 83);
    assert.equal(result.label, 'positive');
    assert.equal(result.american_control.subtotal, 37);
    assert.equal(result.commentary, 'Strong U.S. footprint.');
  });

  it('strips markdown code fences', () => {
    const wrapped = '```json\n' + JSON.stringify(basePayload) + '\n```';
    const result = parseAndNormalizeAmericaFirstPayload(wrapped);
    assert.equal(result.score, 83);
  });

  it('stacks penalties before clamp', () => {
    const withPenalties = {
      ...basePayload,
      penalties: {
        china_manufacturing: 10,
        china_supply_chain: 10,
        foreign_gov_control: 0,
        low_us_workforce: 0,
        adversarial_regulatory: 0,
        total: 20,
      },
    };
    const result = parseAndNormalizeAmericaFirstPayload(JSON.stringify(withPenalties));
    assert.equal(result.score, 63);
    assert.equal(result.penalties.total, 20);
  });

  it('clamps score at 0 when penalties exceed positives', () => {
    const negative = {
      ...basePayload,
      american_control: { headquarters: 2, ceo_us: 2, founder_us: 2, board_us: 2, subtotal: 8 },
      american_economic_benefit: {
        workforce: 2,
        manufacturing: 2,
        rd: 2,
        taxes_capex: 2,
        subtotal: 8,
      },
      strategic_importance: {
        defense: 1,
        energy: 1,
        semiconductors_ai: 1,
        critical_infrastructure: 1,
        subtotal: 4,
      },
      penalties: {
        china_manufacturing: 10,
        china_supply_chain: 10,
        foreign_gov_control: 20,
        low_us_workforce: 10,
        adversarial_regulatory: 10,
        total: 60,
      },
    };
    const result = parseAndNormalizeAmericaFirstPayload(JSON.stringify(negative));
    assert.equal(result.score, 0);
    assert.equal(result.label, 'negative');
  });
});

describe('recomputeAmericaFirstScore', () => {
  it('matches CON-190 formula', () => {
    const score = recomputeAmericaFirstScore({
      american_control: { headquarters: 10, ceo_us: 10, founder_us: 10, board_us: 10, subtotal: 40 },
      american_economic_benefit: {
        workforce: 10,
        manufacturing: 10,
        rd: 10,
        taxes_capex: 10,
        subtotal: 40,
      },
      strategic_importance: {
        defense: 5,
        energy: 5,
        semiconductors_ai: 5,
        critical_infrastructure: 5,
        subtotal: 20,
      },
      penalties: {
        china_manufacturing: 10,
        china_supply_chain: 10,
        foreign_gov_control: 0,
        low_us_workforce: 0,
        adversarial_regulatory: 0,
        total: 20,
      },
    });
    assert.equal(score, 80);
  });
});
