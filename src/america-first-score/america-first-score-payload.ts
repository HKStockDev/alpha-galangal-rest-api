export type AmericaFirstLabel = 'positive' | 'neutral' | 'negative';

export type AmericaFirstControl = {
  headquarters: number;
  ceo_us: number;
  founder_us: number;
  board_us: number;
  subtotal: number;
};

export type AmericaFirstEconomicBenefit = {
  workforce: number;
  manufacturing: number;
  rd: number;
  taxes_capex: number;
  subtotal: number;
};

export type AmericaFirstStrategicImportance = {
  defense: number;
  energy: number;
  semiconductors_ai: number;
  critical_infrastructure: number;
  subtotal: number;
};

export type AmericaFirstPenalties = {
  china_manufacturing: number;
  china_supply_chain: number;
  foreign_gov_control: number;
  low_us_workforce: number;
  adversarial_regulatory: number;
  total: number;
};

export type AmericaFirstLlmResult = {
  model?: string;
  score: number;
  label: AmericaFirstLabel;
  confidence: number;
  american_control: AmericaFirstControl;
  american_economic_benefit: AmericaFirstEconomicBenefit;
  strategic_importance: AmericaFirstStrategicImportance;
  penalties: AmericaFirstPenalties;
  commentary: string;
};

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function normalizeAmericaFirstLabel(score: number): AmericaFirstLabel {
  if (score >= 70) return 'positive';
  if (score >= 40) return 'neutral';
  return 'negative';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampSub(value: unknown, max: number): number {
  return clamp(coerceNumber(value) ?? 0, 0, max);
}

function parseControl(raw: Record<string, unknown>): AmericaFirstControl {
  const headquarters = clampSub(raw.headquarters, 10);
  const ceo_us = clampSub(raw.ceo_us, 10);
  const founder_us = clampSub(raw.founder_us, 10);
  const board_us = clampSub(raw.board_us, 10);
  const subtotalRaw = coerceNumber(raw.subtotal);
  const subtotal =
    subtotalRaw != null
      ? clamp(subtotalRaw, 0, 40)
      : clamp(headquarters + ceo_us + founder_us + board_us, 0, 40);
  return { headquarters, ceo_us, founder_us, board_us, subtotal };
}

function parseEconomicBenefit(raw: Record<string, unknown>): AmericaFirstEconomicBenefit {
  const workforce = clampSub(raw.workforce, 10);
  const manufacturing = clampSub(raw.manufacturing, 10);
  const rd = clampSub(raw.rd, 10);
  const taxes_capex = clampSub(raw.taxes_capex, 10);
  const subtotalRaw = coerceNumber(raw.subtotal);
  const subtotal =
    subtotalRaw != null
      ? clamp(subtotalRaw, 0, 40)
      : clamp(workforce + manufacturing + rd + taxes_capex, 0, 40);
  return { workforce, manufacturing, rd, taxes_capex, subtotal };
}

function parseStrategicImportance(raw: Record<string, unknown>): AmericaFirstStrategicImportance {
  const defense = clampSub(raw.defense, 5);
  const energy = clampSub(raw.energy, 5);
  const semiconductors_ai = clampSub(raw.semiconductors_ai, 5);
  const critical_infrastructure = clampSub(raw.critical_infrastructure, 5);
  const subtotalRaw = coerceNumber(raw.subtotal);
  const subtotal =
    subtotalRaw != null
      ? clamp(subtotalRaw, 0, 20)
      : clamp(defense + energy + semiconductors_ai + critical_infrastructure, 0, 20);
  return { defense, energy, semiconductors_ai, critical_infrastructure, subtotal };
}

function parsePenalties(raw: Record<string, unknown>): AmericaFirstPenalties {
  const china_manufacturing = clampSub(raw.china_manufacturing, 10);
  const china_supply_chain = clampSub(raw.china_supply_chain, 10);
  const foreign_gov_control = clampSub(raw.foreign_gov_control, 20);
  const low_us_workforce = clampSub(raw.low_us_workforce, 10);
  const adversarial_regulatory = clampSub(raw.adversarial_regulatory, 10);
  const totalRaw = coerceNumber(raw.total);
  const total =
    totalRaw != null
      ? clamp(totalRaw, 0, 60)
      : china_manufacturing +
        china_supply_chain +
        foreign_gov_control +
        low_us_workforce +
        adversarial_regulatory;
  return {
    china_manufacturing,
    china_supply_chain,
    foreign_gov_control,
    low_us_workforce,
    adversarial_regulatory,
    total,
  };
}

export function recomputeAmericaFirstScore(parts: {
  american_control: AmericaFirstControl;
  american_economic_benefit: AmericaFirstEconomicBenefit;
  strategic_importance: AmericaFirstStrategicImportance;
  penalties: AmericaFirstPenalties;
}): number {
  const raw =
    parts.american_control.subtotal +
    parts.american_economic_benefit.subtotal +
    parts.strategic_importance.subtotal -
    parts.penalties.total;
  return Math.round(clamp(raw, 0, 100) * 100) / 100;
}

export function parseAndNormalizeAmericaFirstPayload(rawText: string): AmericaFirstLlmResult {
  let raw = rawText.trim();
  const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (codeBlock) raw = codeBlock[1].trim();
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const american_control = parseControl((parsed.american_control ?? {}) as Record<string, unknown>);
  const american_economic_benefit = parseEconomicBenefit(
    (parsed.american_economic_benefit ?? {}) as Record<string, unknown>,
  );
  const strategic_importance = parseStrategicImportance(
    (parsed.strategic_importance ?? {}) as Record<string, unknown>,
  );
  const penalties = parsePenalties((parsed.penalties ?? {}) as Record<string, unknown>);

  const canonicalScore = recomputeAmericaFirstScore({
    american_control,
    american_economic_benefit,
    strategic_importance,
    penalties,
  });

  const llmScore = coerceNumber(parsed.score);
  const score =
    llmScore != null && Math.abs(llmScore - canonicalScore) > 0.01 ? canonicalScore : canonicalScore;

  const confidenceRaw = coerceNumber(parsed.confidence) ?? 0.5;
  const confidence = Math.round(clamp(confidenceRaw, 0, 1) * 10000) / 10000;
  const commentary =
    typeof parsed.commentary === 'string'
      ? parsed.commentary
      : typeof parsed.summary === 'string'
        ? parsed.summary
        : '';

  return {
    model: typeof parsed.model === 'string' ? parsed.model : 'america_first',
    score,
    label: normalizeAmericaFirstLabel(score),
    confidence,
    american_control,
    american_economic_benefit,
    strategic_importance,
    penalties,
    commentary,
  };
}
