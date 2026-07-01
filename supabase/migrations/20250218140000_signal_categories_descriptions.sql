update public.signal_categories set description = 'Fundamental quality of the business: moat, capital allocation, unit economics, and competitive position.' where name = 'BUSINESS_QUALITY';
update public.signal_categories set description = 'Valuation gaps and mean reversion: cheap vs rich on earnings, assets, or cash flows relative to history or peers.' where name = 'MISPRICING';
update public.signal_categories set description = 'Flows of capital: institutional buying/selling, insider activity, fund flows, and positioning shifts.' where name = 'CAPITAL_FLOWS';
update public.signal_categories set description = 'Crowding and positioning: stretched longs/shorts, sentiment extremes, and contrarian positioning signals.' where name = 'POSITIONING_PRESSURE';
update public.signal_categories set description = 'Narrative and sentiment: news tone, social sentiment, and how the story is priced into the market.' where name = 'NARRATIVE_SENTIMENT';
update public.signal_categories set description = 'Macro regime and environment: rates, growth, inflation, and regime-dependent risk/opportunity.' where name = 'MACRO_REGIME';
update public.signal_categories set description = 'Structural and tail risks: leverage, concentration, liquidity, governance, and secular threats.' where name = 'STRUCTURAL_RISK';
update public.signal_categories set description = 'Synthesis of multiple inputs via models or LLMs: committee scores, composite signals, and AI-assisted assessment.' where name = 'INTELLIGENCE_SYNTHESIS';
