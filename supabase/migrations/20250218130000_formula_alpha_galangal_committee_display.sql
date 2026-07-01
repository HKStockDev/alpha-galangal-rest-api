update public.formulas
set
  display_formula = '0.20×Buffett + 0.15×Burry + 0.20×Druckenmiller + 0.10×Wood + 0.15×Graham + 0.20×Lynch',
  description = 'LLM-based investment committee score (0–100) combining six member subscores: Buffett (moat/value), Burry (deep value), Druckenmiller (macro/momentum), Wood (innovation), Graham (quant value), Lynch (GARP). Weights configurable; output includes weighted score, confidence, summary, and key strengths/risks.'
where key = 'alpha_galangal_committee_llm';
