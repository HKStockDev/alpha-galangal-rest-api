# Schema: Notes and Examples

Dead-simple explanations for each table.

| Table | Notes | Example |
|-------|--------|---------|
| `committees` | A political committee that a member of Congress sits on. | Elizabeth Warren sits on the U.S. Senate Committee on Banking, Housing, and Urban Affairs. |
| `entities` | The thing being scored or measured (a company, fund, or person). | Apple the company, or a specific hedge fund like "Bridgewater Associates." |
| `entity_factor_values` | Latest snapshot value for one metric (factor) per entity. | Apple’s open jobs count right now = 1500. |
| `entity_factor_values_ts` | History of that metric over time (for charts and backtests). | Apple’s open jobs count on 2024-01-15, 2024-02-15, etc. |
| `entity_scores_current` | Latest score from a formula (e.g. quality score) per entity. | Hedge fund X’s current quality score = 72. |
| `entity_scores_history` | Past formula scores so you can see how they changed. | That same fund’s quality score last month, last quarter, etc. |
| `exposures` | Dictionary of risk/thematic exposures (e.g. "AI", "China"). | "Semiconductor supply chain" or "Interest rate sensitivity." |
| `factors` | A single metric or variable used in formulas (the building blocks). | Open jobs count, employee count, or 3-year performance. |
| `formula_components` | Links formulas to sub-formulas and their weights. | "Quality score = 0.3×performance + 0.25×risk + …". |
| `formulas` | A named calculation that produces one score from factors. | "Hedge fund quality score" or "Hiring intensity." |
| `hedge_funds` | One row per hedge fund (13F filer); identity and link to entity. | Bridgewater Associates, filer_id 12345, entity_id = xyz. |
| `hedge_funds_list` | View: hedge funds plus their current quality score for listing. | Same funds as `hedge_funds` but with score joined in for UI. |
| `politician_committee_memberships` | Which politician sat on which committee in which Congress. | Senator Smith, Banking Committee, 118th Congress, as member. |
| `politician_terms` | A single term in office (Congress number, chamber, dates). | Senator Smith, 118th Congress, 2023–2025. |
| `politicians` | One row per politician; links to an entity. | Nancy Pelosi, bioguide_id P000197, entity_id = abc. |
| `prompt_versions` | One version of an LLM prompt (system + user template, model settings). | Version 1 of "open jobs extraction" with specific instructions. |
| `prompts` | Named prompt (e.g. for extraction); points to active version. | "Open jobs extraction" or "Employee count estimate." |
| `securities` | A tradeable ticker (stock, etc.) with metadata; links to one entity. | AAPL, Apple Inc., entity_id = xyz. |
| `security_classifications` | A security’s sector/industry assignment from a taxonomy (with source/date). | AAPL classified as Technology / Consumer Electronics as of 2024-01-01. |
| `security_exposures` | Links a security to an exposure and whether it benefits or is hurt. | AAPL → "AI" as beneficiary, strength 0.8. |
| `security_tags` | Links a security to a tag (e.g. "ESG", "Value") with optional confidence. | AAPL tagged "Mega cap" with confidence 1.0. |
| `sic_to_taxonomy_map` | Maps SIC codes to taxonomy nodes so we can auto-classify by SIC. | SIC 3571 → "Technology / Computer hardware" node. |
| `signal_categories` | High-level bucket for formulas (e.g. Business Quality, Macro). | "BUSINESS_QUALITY", "CAPITAL_FLOWS." |
| `tags` | Dictionary of tags you can attach to securities. | "Mega cap", "ESG leader", "High insider buying." |
| `taxonomies` | A classification scheme (e.g. GICS, custom sector/industry tree). | "GICS" or "Custom sector/industry." |
| `taxonomy_nodes` | One node in a taxonomy (sector, industry group, industry, sub-industry). | "Technology" (sector), "Semiconductors" (sub-industry). |
