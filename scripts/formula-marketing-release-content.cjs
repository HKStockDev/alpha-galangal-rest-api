/**
 * Real marketing release copy keyed by formulas.key.
 * Each formula has two releases: release1 (older snapshot), release2 (newer snapshot).
 */

function body(...paragraphs) {
  return paragraphs.join('\n\n');
}

const CONTENT = {
  alpha_galangal_committee_buffett_score: {
    release1: {
      title: 'Buffett Score — Quality & Capital Discipline',
      subtitle: 'Moat strength, owner earnings, and balance-sheet resilience for long-horizon investors.',
      seo_title: 'Buffett Score | Quality businesses & capital preservation',
      seo_description:
        'Alpha Galangal Buffett Score ranks securities on durable moats, reinvestment quality, and downside-aware capital allocation.',
      body: body(
        'The **Buffett Score** evaluates businesses the way a long-term owner would: durable competitive advantages, understandable economics, and management that allocates capital with discipline rather than ego.',
        'This release emphasizes **quality over noise**. Names that score highly typically combine consistent owner earnings, prudent leverage, and pricing power that can absorb inflation without destroying margins. For advisors focused on **capital preservation**, the score surfaces companies where book value and cash generation tend to compound rather than erode through dilution or serial restructuring.',
        'Use this lens when clients ask for “sleep well at night” equities—not by avoiding growth, but by prioritizing franchises that can survive cyclical stress without permanent impairment.',
        '**How to read the ranking:** higher scores indicate stronger alignment with Buffett-style quality and capital discipline; pair with your firm’s risk budget and position-sizing rules.',
      ),
    },
    release2: {
      title: 'Buffett Score — Q1 2025 Refresh',
      subtitle: 'Updated snapshot with sharper focus on balance-sheet strength and reinvestment returns.',
      seo_title: 'Buffett Score Q1 2025 | Moat & preservation update',
      seo_description:
        'Q1 2025 Buffett Score refresh highlights balance-sheet resilience and owner-earnings quality for capital-preservation-oriented portfolios.',
      body: body(
        'This **Q1 2025 refresh** updates the Buffett Score universe after another earnings season. We re-weighted emphasis toward **balance-sheet resilience** and **return on incremental capital**—two inputs that matter most when volatility rises and credit tightens.',
        'Securities leading the refresh often share three traits: net cash or manageable debt, pricing power in the core franchise, and management teams that repurchase stock only when intrinsic value clearly exceeds price.',
        'For **downside protection** workflows, filter for high Buffett scores alongside low net leverage. That combination has historically separated “cheap cyclicals” from genuinely defensive compounders.',
        'Consult the ranked table for current leaders and laggards; methodology and factor weights are documented in the formula hub.',
      ),
    },
  },

  alpha_galangal_committee_burry_score: {
    release1: {
      title: 'Burry Score — Deep Value & Asymmetric Setups',
      subtitle: 'Contrarian mispricing, balance-sheet optionality, and catalyst-aware downside math.',
      seo_title: 'Burry Score | Deep value & downside-aware investing',
      seo_description:
        'Burry Score identifies mispriced securities with catalyst paths and explicit downside framing for contrarian portfolios.',
      body: body(
        'The **Burry Score** looks for securities the market may be mispricing—often where fear, complexity, or accounting noise obscures underlying asset value.',
        'Unlike momentum screens, this model rewards **asymmetric payoff structures**: limited downside when net assets or cash flows are tangible, with identifiable catalysts that could unlock value.',
        '**Capital preservation** here means knowing what you own: the score penalizes opaque leverage, chronic dilution, and business models where equity is structurally subordinated.',
        'Advisors use Burry scores to stress-test contrarian ideas before sizing—high score is necessary but not sufficient without liquidity and client mandate fit.',
      ),
    },
    release2: {
      title: 'Burry Score — January 2025 Catalyst Map',
      subtitle: 'Post-earnings reset: where dislocation meets improving liquidity.',
      seo_title: 'Burry Score Jan 2025 | Contrarian catalyst update',
      seo_description:
        'January 2025 Burry Score update maps contrarian setups with clearer catalysts and tighter downside framing.',
      body: body(
        'The **January 2025** Burry refresh incorporates fresh filings and revised liquidity conditions. Several names moved up as working-capital normalization and asset sales improved tangible book coverage.',
        'We continue to flag securities where **downside protection** comes from asset backing or cash, not from hope. The score deprioritizes story stocks without a path to free-cash-flow conversion.',
        'Pair Burry leaders with your firm’s risk controls: position limits, stop rules, and client suitability for deep-value volatility are essential.',
        'See the release table for current top and bottom deciles relative to the prior October snapshot.',
      ),
    },
  },

  alpha_galangal_committee_druckenmiller_score: {
    release1: {
      title: 'Druckenmiller Score — Macro-Aware Growth',
      subtitle: 'Liquidity, momentum, and thematic tailwinds with risk-off discipline.',
      seo_title: 'Druckenmiller Score | Macro momentum investing',
      seo_description:
        'Druckenmiller Score ranks securities on macro-sensitive growth, liquidity, and momentum with explicit risk-off awareness.',
      body: body(
        'The **Druckenmiller Score** blends macro context with security-level momentum: where is liquidity flowing, which themes are accelerating, and which managements are executing into that backdrop?',
        'This is not a blind momentum chase. The model discounts names with deteriorating fundamentals even when price action looks strong—protecting against **late-cycle blow-offs**.',
        'For growth-oriented mandates, use Druckenmiller scores to time entry when macro tailwinds align with earnings revision breadth.',
        'When volatility spikes, consider trimming low-score names first—they often lack both fundamental and technical support.',
      ),
    },
    release2: {
      title: 'Druckenmiller Score — Q1 2025 Macro Shift',
      subtitle: 'Rates, liquidity, and sector rotation reflected in the latest ranking.',
      seo_title: 'Druckenmiller Score Q1 2025 | Macro rotation update',
      seo_description:
        'Q1 2025 Druckenmiller Score refresh reflects shifting rates, liquidity conditions, and sector leadership.',
      body: body(
        '**Q1 2025** updates incorporate shifting rate expectations and revised sector leadership. Leaders increasingly cluster where earnings revisions are positive *and* price trend confirms institutional sponsorship.',
        'We highlight securities losing macro sponsorship despite stable headlines—these often precede drawdowns when liquidity tightens.',
        'Advisors balancing growth with **volatility control** can pair Druckenmiller with lower-beta sleeves or explicit hedges when average scores compress market-wide.',
        'Review the ranked list for names whose scores improved most versus the prior release.',
      ),
    },
  },

  alpha_galangal_committee_graham_score: {
    release1: {
      title: 'Graham Score — Margin of Safety & Downside Protection',
      subtitle: 'Quantitative value, net-net discipline, and explicit preservation of capital.',
      seo_title: 'Graham Score | Margin of safety & capital preservation',
      seo_description:
        'Graham Score emphasizes margin of safety, balance-sheet strength, and downside protection for value-oriented investors.',
      body: body(
        'The **Graham Score** applies Benjamin Graham’s discipline in a modern data pipeline: **margin of safety**, tangible book support, and earnings stability over promotional narratives.',
        'This release is central for clients who ask about **capital preservation** and **downside protection**. High-scoring names typically trade at conservative multiples of normalized earnings or net current asset value, with balance sheets that can absorb a bad year without emergency financing.',
        'We explicitly penalize leverage spikes, goodwill-heavy balance sheets, and earnings driven by one-time items—common sources of **permanent capital loss**.',
        'Use Graham scores as a first filter for value sleeves, then apply qualitative business review before purchase.',
      ),
    },
    release2: {
      title: 'Graham Score — Q1 2025 Value Reset',
      subtitle: 'Wider dislocations create richer margin-of-safety opportunities.',
      seo_title: 'Graham Score Q1 2025 | Value & preservation refresh',
      seo_description:
        'Q1 2025 Graham Score update finds expanded margin-of-safety opportunities amid volatility and wider valuation dispersions.',
      body: body(
        'The **Q1 2025 Graham refresh** arrives after a period of wider valuation dispersion. More securities now meet strict **margin-of-safety** thresholds than in the October snapshot—especially in overlooked small and mid-cap industrials.',
        '**Volatility** has been a friend to the patient value investor: short-term price swings often improve entry points without changing long-run liquidation value.',
        'For **preservation of capital** mandates, prioritize Graham leaders with net cash and positive operating cash flow across the last four quarters.',
        'Compare this release to the prior table to see which names newly entered the top quintile.',
      ),
    },
  },

  alpha_galangal_committee_lynch_score: {
    release1: {
      title: 'Lynch Score — GARP & Explainable Growth',
      subtitle: 'Growth at a reasonable price with stories you can explain to clients.',
      seo_title: 'Lynch Score | GARP stock selection',
      seo_description:
        'Lynch Score finds growth at a reasonable price with understandable business drivers and sane valuations.',
      body: body(
        'The **Lynch Score** targets **growth at a reasonable price (GARP)**: companies growing earnings faster than the market but not priced for perfection.',
        'Peter Lynch’s insight—that investors should own what they can explain—shows up in our penalty for incomprehensible revenue recognition, serial acquirers without integration track records, and multiples that imply decades of flawless execution.',
        'For balanced mandates, Lynch scores bridge pure value and pure growth: enough **upside** to matter, enough **valuation discipline** to limit regret on drawdowns.',
        'Review sector concentration before building a Lynch-themed sleeve; the score is security-level, not a diversification tool.',
      ),
    },
    release2: {
      title: 'Lynch Score — January 2025 Earnings Season',
      subtitle: 'Post-earnings GARP reset: who grew into their multiple?',
      seo_title: 'Lynch Score Jan 2025 | GARP earnings update',
      seo_description:
        'January 2025 Lynch Score refresh after earnings season—who delivered growth without multiple expansion risk.',
      body: body(
        '**January 2025** incorporates reported EPS and guidance trends. Names rising in the ranks typically beat on volume-led growth while keeping valuations near historical medians.',
        'We downgrade “story stocks” where multiples expanded faster than earnings—classic **downside** setup when sentiment reverses.',
        'Advisors can use Lynch score deltas to refresh model portfolios without abandoning GARP discipline.',
        'See the release rankings for the largest positive and negative movers since October.',
      ),
    },
  },

  alpha_galangal_committee_wood_score: {
    release1: {
      title: 'Wood Score — Innovation & Disruptive Growth',
      subtitle: 'Long-horizon innovation with execution and runway visibility.',
      seo_title: 'Wood Score | Innovation & disruptive growth',
      seo_description:
        'Wood Score ranks innovation-led growth companies with disruptive potential and measurable execution milestones.',
      body: body(
        'The **Wood Score** evaluates innovation-led growth: large addressable markets, disruptive technology or business models, and management with a credible path to scale.',
        'This is intentionally **higher volatility** than Graham or Buffett lenses. **Capital preservation** is not the primary goal—optionality is. Clients need mandate fit and position sizing accordingly.',
        'The score still penalizes science projects without revenue traction or financing overhangs that threaten dilution.',
        'Use Wood scores for satellite growth allocations, not as a core defensive anchor.',
      ),
    },
    release2: {
      title: 'Wood Score — Q1 2025 Innovation Pulse',
      subtitle: 'Which disruptive themes gained execution proof this quarter?',
      seo_title: 'Wood Score Q1 2025 | Innovation update',
      seo_description:
        'Q1 2025 Wood Score update tracks disruptive themes with improving execution and funding clarity.',
      body: body(
        '**Q1 2025** refresh weights recent product milestones, partnership announcements, and revenue inflection points more heavily than narrative alone.',
        'Leaders often cluster in areas where cost curves are falling fast enough to expand adoption—even in a cautious macro backdrop.',
        'Risk-aware advisors should pair Wood leaders with explicit portfolio volatility budgets and rebalancing rules.',
        'Check score changes versus the October release before adding to innovation sleeves.',
      ),
    },
  },

  alpha_galangal_committee_llm: {
    release1: {
      title: 'Alpha Galangal Committee — Composite Investment View',
      subtitle: 'Six legendary lenses combined into one explainable committee score.',
      seo_title: 'Alpha Galangal Committee | Composite LLM investment score',
      seo_description:
        'Alpha Galangal Committee blends Buffett, Burry, Druckenmiller, Wood, Graham, and Lynch subscores into one weighted investment view.',
      body: body(
        'The **Alpha Galangal Committee** model synthesizes six investor archetypes—Buffett, Burry, Druckenmiller, Wood, Graham, and Lynch—into a single **0–100 committee score** with confidence, summary, and key strengths/risks.',
        'Default weights balance quality, value, macro growth, innovation, margin of safety, and GARP. Firms can tune weights to match client mandates—from **capital preservation** (heavier Graham/Buffett) to aggressive growth (heavier Wood/Druckenmiller).',
        'Each security’s output is designed for advisor conversations: not just a number, but *why* the committee agrees or disagrees with the market.',
        'Use subscores to diagnose disagreements—e.g., high Graham but low Wood implies a value name without growth optionality.',
      ),
    },
    release2: {
      title: 'Committee Score — Q1 2025 Weighting Review',
      subtitle: 'Refined subscore weights and clearer risk flags in committee output.',
      seo_title: 'Alpha Galangal Committee Q1 2025 update',
      seo_description:
        'Q1 2025 Committee refresh with refined subscore weights and improved risk summaries for advisors.',
      body: body(
        '**Q1 2025** introduces clearer **risk flags** when subscores diverge sharply—often a sign of controversial names (loved by one lens, hated by another).',
        'We document when **downside protection** inputs (Graham/Buffett) conflict with momentum inputs (Druckenmiller)—helping advisors set client expectations before purchase.',
        'Committee summaries now call out leverage, dilution, and cyclicality explicitly when material.',
        'Compare composite rankings to individual subscore releases for a full picture.',
      ),
    },
  },

  fundamental_constriction_score: {
    release1: {
      title: 'Fundamental Constriction Score — Operating Leverage Inflection',
      subtitle: 'Earnings acceleration, margins, ROIC, valuation, and balance sheet in one FMP-backed score.',
      seo_title: 'Fundamental Constriction Score | Earnings & quality factors',
      seo_description:
        'Fundamental Constriction Score blends earnings acceleration, margin expansion, ROIC, valuation, and balance sheet strength.',
      body: body(
        'The **Fundamental Constriction Score** measures whether fundamentals are **inflecting positively**—earnings acceleration, margin expansion, ROIC improvement—while respecting valuation and balance-sheet constraints.',
        'For investors focused on **quality and downside awareness**, the balance-sheet and valuation components act as brakes on pure growth chasing.',
        'Formula: `0.29×EA + 0.24×ME + 0.19×ROIC + 0.16×VC + 0.12×BS` using percentile ranks across the universe.',
        'High scores indicate tightening positive fundamentals without reckless multiple expansion.',
      ),
    },
    release2: {
      title: 'Fundamental Constriction — Q1 2025 Factor Refresh',
      subtitle: 'Post-earnings update across all five factor pillars.',
      seo_title: 'Fundamental Constriction Q1 2025 update',
      seo_description:
        'Q1 2025 Fundamental Constriction refresh after earnings with updated factor percentiles.',
      body: body(
        '**Q1 2025** recalculates factor percentiles after another earnings cycle. Margin expansion and ROIC improvement saw the largest cross-sectional shifts.',
        'Names with rising scores often show **operating leverage** emerging—not just cost cuts, but volume-led margin recovery.',
        'When **volatility** rises, prioritize high scores with strong balance-sheet pillar contribution for more resilient sleeves.',
        'Review the ranked securities table for current leaders and methodology notes on the formula hub.',
      ),
    },
  },

  net_exposure_score: {
    release1: {
      title: 'Net Exposure Score — Tailwinds vs Headwinds',
      subtitle: 'Aggregate exposure polarity across macro, demand, regulatory, and capital-cycle tags.',
      seo_title: 'Net Exposure Score | Macro & thematic exposures',
      seo_description:
        'Net Exposure Score sums signed exposure terms to show net tailwind or headwind for each security.',
      body: body(
        'The **Net Exposure Score** aggregates tagged exposures—macro, demand, regulatory, capital cycle—into a single **net tailwind / headwind** reading per security.',
        'Advisors use it to explain *why* a stock may be sensitive to rates, supply chain, or policy shifts without building custom spreadsheets.',
        'For **risk management**, pair negative net exposure names with position limits or hedges; positive net exposure can justify growth overweight when fundamentals confirm.',
        'Tailwind and headwind components are reported separately for transparency.',
      ),
    },
    release2: {
      title: 'Net Exposure — Q1 2025 Regime Update',
      subtitle: 'Exposure tags refreshed for shifting macro and policy landscape.',
      seo_title: 'Net Exposure Score Q1 2025 | Exposure refresh',
      seo_description:
        'Q1 2025 Net Exposure update reflects revised macro and policy exposure tags across the universe.',
      body: body(
        '**Q1 2025** refreshes exposure mappings after taxonomy and macro assumption updates. Several sectors saw net exposure flip as rate and regulatory tags were revised.',
        'This release is useful when clients ask how **volatile macro headlines** map to holdings—not as a market timer, but as a **risk inventory**.',
        'Combine Net Exposure with Fundamental Constriction or Graham scores to avoid headwind-heavy value traps.',
        'See the release table for securities with the largest net exposure changes since October.',
      ),
    },
  },

  political_score: {
    release1: {
      title: 'Political Score — Congressional Trade Signal',
      subtitle: 'Committee overlap, trade clustering, and disclosure timing from FMP data.',
      seo_title: 'Political Score | Congressional trading signal',
      seo_description:
        'Political Score quantifies congressional trading activity, committee relevance, and clustering for US equities.',
      body: body(
        'The **Political Score** turns congressional disclosure data into an investable signal: buy/sell imbalance, trade recency, committee relevance, and issuer clustering.',
        'It is a **supplemental** factor—not a standalone mandate. Transparency and lagged reporting mean scores can change when new filings arrive.',
        'Advisors use Political Score to flag names with unusual bipartisan interest or committee-aligned accumulation.',
        'Formula components include trade score, committee relevance, recency, intensity, and clustering weights per Formulas.md.',
      ),
    },
    release2: {
      title: 'Political Score — January 2025 Filing Wave',
      subtitle: 'New disclosures and committee membership changes incorporated.',
      seo_title: 'Political Score Jan 2025 | Filing update',
      seo_description:
        'January 2025 Political Score update incorporates new congressional filings and committee changes.',
      body: body(
        '**January 2025** ingests the latest filing wave and updated committee memberships. Several tickers moved materially on clustered purchases in policy-sensitive sectors.',
        'We continue to emphasize **disclosure lag**: scores describe reported activity, not real-time positioning.',
        'Pair Political signals with liquidity and fundamental screens before acting—political interest does not imply correctness.',
        'Compare this ranking to the October release for the largest movers.',
      ),
    },
  },

  america_first_score: {
    release1: {
      title: 'America First Score — U.S. Economic Alignment',
      subtitle: 'American control, domestic economic benefit, strategic importance, and penalty-adjusted composite.',
      seo_title: 'America First Score | U.S. alignment & domestic benefit',
      seo_description:
        'America First Score ranks securities on U.S. headquarters, workforce, manufacturing, R&D, strategic sectors, and penalty factors for offshore dependence.',
      body: body(
        'The **America First Score** estimates how strongly a company benefits and aligns with the United States economy, workforce, industrial base, and strategic interests.',
        'The rubric combines **American Control** (HQ, leadership, board), **American Economic Benefit** (workforce, manufacturing, R&D, taxes/capex), and **Strategic Importance** (defense, energy, semiconductors/AI, critical infrastructure).',
        'Penalties subtract for heavy China manufacturing dependence, foreign government control, low U.S. workforce share, and adversarial regulatory exposure.',
        'Use as a thematic overlay for domestic-reshoring and policy-sensitive portfolios—not as a political opinion score.',
      ),
    },
    release2: {
      title: 'America First Score — Q1 2025 Refresh',
      subtitle: 'Updated LLM rubric snapshot across the active U.S. equity universe.',
      seo_title: 'America First Score Q1 2025 | Domestic alignment update',
      seo_description:
        'Q1 2025 America First Score refresh with revised domestic alignment rankings and penalty adjustments.',
      body: body(
        '**Q1 2025** refreshes America First scores after another earnings and disclosure cycle. Several industrials and defense names moved up on stronger U.S. manufacturing and workforce signals.',
        'Penalties for China supply-chain concentration remain material for consumer electronics and apparel names.',
        'Pair America First leaders with Fundamental Constriction or Net Exposure for a fuller risk picture.',
        'See the release table for current top and bottom deciles versus the prior snapshot.',
      ),
    },
  },

  insider_conviction_score: {
    release1: {
      title: 'Insider Conviction Score — Form 4 Flow Signal',
      subtitle: 'Open-market buys and sells, roles, recency, and clustering.',
      seo_title: 'Insider Conviction Score | Insider buying signal',
      seo_description:
        'Insider Conviction Score measures open-market insider activity with role weights, recency, and clustering.',
      body: body(
        'The **Insider Conviction Score** analyzes Form 4-style flows: open-market purchases and sales, officer vs director weighting, recency, and buy clustering.',
        'Insider buying is not a guarantee—but persistent **net buying** by economic decision-makers often aligns with management’s private view of value.',
        'The score normalizes for market cap and filters noise from automatic sales and plan trades where possible.',
        'Use as a conviction overlay on value or growth theses—not as a timing tool for illiquid micro-caps.',
      ),
    },
    release2: {
      title: 'Insider Conviction — Q1 2025 Flow Update',
      subtitle: 'Fresh Form 4 activity and revised clustering windows.',
      seo_title: 'Insider Conviction Q1 2025 update',
      seo_description:
        'Q1 2025 Insider Conviction refresh with updated Form 4 flows and clustering.',
      body: body(
        '**Q1 2025** recalculates insider pressure after year-end filing season. Clustered buying increased in several industrials and financials relative to the October snapshot.',
        'We flag names where insider selling accelerated despite flat prices—potential **downside** information not yet in consensus estimates.',
        'Advisors should verify filing interpretation for complex corporate structures before client outreach.',
        'See ranked results for top conviction buys and notable sell pressure.',
      ),
    },
  },

  hedge_fund_quality_score: {
    release1: {
      title: 'Hedge Fund Quality Score — Manager Composite',
      subtitle: 'Performance, risk, conviction, institutional strength, and positioning combined.',
      seo_title: 'Hedge Fund Quality Score | 13F manager ranking',
      seo_description:
        'Composite hedge fund quality score from performance, risk, conviction, institutional strength, and positioning subscores.',
      body: body(
        'The **Hedge Fund Quality Score** combines five normalized pillars—performance, risk, conviction, institutional strength, and positioning—into a single manager quality rank.',
        'For allocator workflows, it surfaces managers with **durable track records** and positioning consistent with active equity skill—not passive beta dressed as alpha.',
        'Risk pillar inputs favor lower volatility and Sortino relative to peers; positioning penalizes excessive ETF/option/put reliance.',
        'Use to shortlist managers for due diligence, not as a substitute for operational due diligence.',
      ),
    },
    release2: {
      title: 'Hedge Fund Quality — Q1 2025 13F Refresh',
      subtitle: 'Latest 13F positioning and rolling performance windows updated.',
      seo_title: 'Hedge Fund Quality Q1 2025 update',
      seo_description:
        'Q1 2025 hedge fund quality refresh with updated 13F holdings and performance metrics.',
      body: body(
        '**Q1 2025** updates all subscores after new 13F filings. Conviction and positioning saw the largest rank changes as managers rotated sector bets.',
        'Managers rising in quality often show **stable risk-adjusted returns** without extreme factor tilts that reverse violently.',
        'When markets stress, quality-ranked managers historically show smaller drawdown dispersion—but past results vary.',
        'Review the manager table for current composite leaders.',
      ),
    },
  },

  hedge_fund_risk: {
    release1: {
      title: 'Hedge Fund Risk — Volatility & Capital Preservation Lens',
      subtitle: 'Sortino, standard deviation, and beta discipline for manager selection.',
      seo_title: 'Hedge Fund Risk | Volatility & downside control',
      seo_description:
        'Hedge Fund Risk score favors higher Sortino, lower volatility, and beta near 1 for capital-preservation-aware allocator review.',
      body: body(
        'The **Hedge Fund Risk** subscore rewards managers with strong **Sortino ratios**, **lower volatility**, and **beta near 1**—a capital-preservation-aware view of hedge fund return streams.',
        'Formula: `0.50×z(sortino) − 0.30×z(stddev) − 0.20×|z(β−1)|`. Higher is better.',
        'Allocators focused on **downside protection** use this pillar to filter managers who took outsized drawdowns for marginal alpha.',
        'Pair with performance and conviction scores—low risk alone can mean mediocre returns.',
      ),
    },
    release2: {
      title: 'Hedge Fund Risk — Q1 2025 Volatility Regime',
      subtitle: 'Risk metrics recalculated after a more volatile quarter.',
      seo_title: 'Hedge Fund Risk Q1 2025 update',
      seo_description:
        'Q1 2025 hedge fund risk refresh after elevated market volatility—who protected capital.',
      body: body(
        '**Q1 2025** risk windows capture a more volatile macro period. Managers who protected **capital** rose in rank even when absolute returns were modest.',
        'Beta drift above 1.5 without commensurate returns triggered downgrades—classic **hidden equity risk** in “market-neutral” marketing.',
        'Use this release when clients ask which managers historically respected **volatility and downside** constraints.',
        'See the updated risk-ranked manager list in the release table.',
      ),
    },
  },

  hedge_fund_performance: {
    release1: {
      title: 'Hedge Fund Performance — Multi-Horizon Returns',
      subtitle: '3Y, 5Y, 7Y, manager-weighted 5Y, and 3Y alpha via z-scores.',
      seo_title: 'Hedge Fund Performance score',
      seo_description:
        'Hedge fund performance subscore from multi-horizon returns and 3Y alpha normalized via z-scores.',
      body: body(
        'The **Hedge Fund Performance** subscore weights 3Y, 5Y, 7Y, and manager-weighted 5Y annualized returns plus 3Y alpha using cross-sectional z-scores.',
        'It answers: *who actually compounded* across cycles—not who had one lucky year.',
        'Performance without risk context can mislead; always review alongside **Hedge Fund Risk**.',
        'Suitable for allocator screens and manager monitoring dashboards.',
      ),
    },
    release2: {
      title: 'Hedge Fund Performance — Q1 2025 Window Roll',
      subtitle: 'Rolling return windows advanced; alpha leaders reshuffled.',
      seo_title: 'Hedge Fund Performance Q1 2025',
      seo_description:
        'Q1 2025 hedge fund performance update with rolled return windows and refreshed alpha ranks.',
      body: body(
        '**Q1 2025** rolls performance windows forward one quarter. Several managers faded as older strong years dropped out of the 7Y lookback.',
        'Alpha leaders often combine consistent mid-tier absolute returns with low correlation to equity beta—worth diligence for **all-weather** sleeves.',
        'Downgrade managers whose performance is entirely explained by factor exposure revealed in positioning data.',
        'Consult the release rankings for the current performance quintiles.',
      ),
    },
  },

  hedge_fund_conviction: {
    release1: {
      title: 'Hedge Fund Conviction — Concentration & Holding Period',
      subtitle: 'Top-10 concentration, time in top holdings, and turnover discipline.',
      seo_title: 'Hedge Fund Conviction score',
      seo_description:
        'Hedge fund conviction from top-10 concentration, average holding period, and turnover.',
      body: body(
        'The **Hedge Fund Conviction** subscore rewards thoughtful concentration: meaningful top-10 weights, longer average time in top holdings, and **lower turnover** than peers.',
        'High conviction can amplify returns—but also **drawdowns** if the thesis is wrong. Use with risk and quality composites.',
        'Formula: `0.35×z(pct_top10) + 0.25×z(avg_time_top10) + 0.25×z(avg_held) − 0.15×z(turnover)`.',
        'Ideal for identifying managers with research depth vs portfolio churn.',
      ),
    },
    release2: {
      title: 'Hedge Fund Conviction — Q1 2025 Holdings Shift',
      subtitle: '13F concentration changes after latest filing period.',
      seo_title: 'Hedge Fund Conviction Q1 2025',
      seo_description:
        'Q1 2025 conviction update from latest 13F concentration and turnover metrics.',
      body: body(
        '**Q1 2025** reflects new 13F snapshots. Conviction rose for managers who **added to winners** rather than rotating endlessly.',
        'Sharp turnover spikes without thesis documentation are penalized—potential sign of style drift.',
        'Advisors explaining manager behavior to clients can cite conviction trends quarter over quarter.',
        'See the release table for conviction leaders and churn outliers.',
      ),
    },
  },

  hedge_fund_institutional_strength: {
    release1: {
      title: 'Hedge Fund Institutional Strength — Scale & Tenure',
      subtitle: 'Log AUM, years active, and 10Y performance combined.',
      seo_title: 'Hedge Fund Institutional Strength',
      seo_description:
        'Institutional strength from AUM scale, manager tenure, and 10-year performance.',
      body: body(
        '**Institutional Strength** blends log AUM, years active, and 10Y annualized performance—proxy for survivorship, operational maturity, and compounding track record.',
        'Larger scale is not always better (capacity constraints), but extreme fragility often shows up in young, tiny, volatile track records.',
        'Use for institutional allocator minimum viability screens.',
        'Pair with risk and positioning for a full manager picture.',
      ),
    },
    release2: {
      title: 'Institutional Strength — Q1 2025 AUM Update',
      subtitle: 'Refreshed AUM estimates and tenure calculations.',
      seo_title: 'Hedge Fund Institutional Strength Q1 2025',
      seo_description:
        'Q1 2025 institutional strength refresh with updated AUM and tenure data.',
      body: body(
        '**Q1 2025** updates AUM and tenure fields from latest regulatory filings. Several managers crossed meaningful scale thresholds.',
        'Tenure upgrades reward managers who navigated multiple cycles—relevant for **long-term capital** commitments.',
        'Downgrades flagged funds with shrinking AUM and rising redemption risk indicators.',
        'Review institutional strength ranks before mandate expansion decisions.',
      ),
    },
  },

  hedge_fund_positioning: {
    release1: {
      title: 'Hedge Fund Positioning — Active Equity Purity',
      subtitle: 'Preference for stock picking over ETF, option, and put wrappers.',
      seo_title: 'Hedge Fund Positioning score',
      seo_description:
        'Hedge fund positioning favors active equity over ETF, option, and put-heavy portfolios.',
      body: body(
        'The **Positioning** subscore prefers genuine stock picking: lower ETF, listed option, and put allocation scores higher.',
        'Formula: `0.50×(1−etf_pct) + 0.30×(1−option_pct) − 0.20×put_pct`.',
        'Helps allocators spot **hidden beta** and derivative-heavy books marketed as alpha strategies.',
        'Combine with performance to see if positioning choices paid off.',
      ),
    },
    release2: {
      title: 'Positioning — Q1 2025 13F Instrument Mix',
      subtitle: 'ETF and derivatives usage shifted in latest filings.',
      seo_title: 'Hedge Fund Positioning Q1 2025',
      seo_description:
        'Q1 2025 positioning update from 13F instrument mix changes.',
      body: body(
        '**Q1 2025** captures increased ETF usage among several macro funds—positioning scores adjusted accordingly.',
        'Rising put weights without clear hedge narrative trigger review for **tail-risk** or distressed macro bets.',
        'Active equity purity remains a useful lens when clients want “stock pickers,” not factor wrappers.',
        'See positioning-ranked managers in the release table.',
      ),
    },
  },

  event_pressure: {
    release1: {
      title: 'Event Pressure — Catalyst Intensity',
      subtitle: 'Signed sum of polarity × severity × materiality over displayable events.',
      seo_title: 'Event Pressure score | News catalyst intensity',
      seo_description:
        'Event Pressure aggregates displayable market events into a signed catalyst intensity score.',
      body: body(
        '**Event Pressure** sums `polarity × severity × materiality` for displayable events in a configurable window (1m / 3m).',
        'Positive pressure suggests a supportive news/catalyst backdrop; negative pressure flags controversy, downgrades, or operational setbacks.',
        'Not a price forecast—a **narrative inventory** advisors can cite in client meetings.',
        'Pair with Positive/Negative Event Count releases for decomposition.',
      ),
    },
    release2: {
      title: 'Event Pressure — Q1 2025 News Window',
      subtitle: 'Refreshed event feed and materiality weighting.',
      seo_title: 'Event Pressure Q1 2025 update',
      seo_description:
        'Q1 2025 Event Pressure refresh with updated news and event classifications.',
      body: body(
        '**Q1 2025** recalculates pressure after classifier and materiality tuning. Several names saw pressure flip on earnings-related events.',
        'Use when explaining **headline risk** vs fundamental trend divergence.',
        'High negative pressure with strong fundamentals may indicate opportunity—or a trap. Qualitative review still required.',
        'Compare 1m vs 3m windows using Event Pressure Trend formula.',
      ),
    },
  },

  event_pressure_trend: {
    release1: {
      title: 'Event Pressure Trend — Improving or Deteriorating Catalysts',
      subtitle: 'Short-window pressure minus longer-window pressure.',
      seo_title: 'Event Pressure Trend | Catalyst momentum',
      seo_description:
        'Event Pressure Trend compares 1m vs 3m catalyst pressure to show improving or worsening news environments.',
      body: body(
        '**Event Pressure Trend** = `event_pressure(1m) − event_pressure(3m)`. Positive values suggest **improving** catalyst environment; negative values suggest deterioration.',
        'Advisors use trend more than level when timing client conversations about **volatility** and headline risk.',
        'Near-zero trend implies a stable news backdrop—often appropriate for **capital preservation** holdings clients want quiet on.',
        'Combine with fundamental scores before acting on trend alone.',
      ),
    },
    release2: {
      title: 'Event Trend — January 2025 Inflection Scan',
      subtitle: 'Which names saw the sharpest catalyst improvement or decay?',
      seo_title: 'Event Pressure Trend Jan 2025',
      seo_description:
        'January 2025 event trend scan highlighting catalyst inflection points.',
      body: body(
        '**January 2025** highlights securities with the largest positive and negative trend deltas.',
        'Improving trend plus strong fundamentals often supports **add** discussions; deteriorating trend may justify **trim** even without price weakness yet.',
        'Trend can reverse quickly when news flow is episodic—monitor monthly.',
        'See ranked trend leaders in the release securities table.',
      ),
    },
  },

  positive_event_count: {
    release1: {
      title: 'Positive Event Count — Bullish Catalyst Volume',
      subtitle: 'Count of displayable positive-polarity events in 1m / 3m windows.',
      seo_title: 'Positive Event Count',
      seo_description:
        'Counts positive displayable market events over 1m and 3m windows per security.',
      body: body(
        '**Positive Event Count** tallies displayable events with `polarity = +1` over the selected window.',
        'Useful for growth and momentum clients who want evidence of **constructive news flow** beyond price alone.',
        'High counts with flat prices may indicate unrecognized improvement; low counts with high prices may indicate **fragile rallies**.',
        'Pair with Negative Event Count for balance.',
      ),
    },
    release2: {
      title: 'Positive Events — Q1 2025 Surge Names',
      subtitle: 'Who accumulated the most constructive headlines this quarter?',
      seo_title: 'Positive Event Count Q1 2025',
      seo_description:
        'Q1 2025 positive event count update highlighting constructive news flow.',
      body: body(
        '**Q1 2025** refresh shows several industrials and tech names with rising positive event counts after product and partnership announcements.',
        'Count alone ignores severity—cross-check Event Pressure for weighted importance.',
        'Advisors building “good news” watchlists can start here, then apply valuation discipline.',
        'Review the release ranking for top positive-event securities.',
      ),
    },
  },

  negative_event_count: {
    release1: {
      title: 'Negative Event Count — Headline & Risk Inventory',
      subtitle: 'Count of displayable negative-polarity events in 1m / 3m windows.',
      seo_title: 'Negative Event Count | Headline risk',
      seo_description:
        'Counts negative displayable market events—useful for downside and headline risk review.',
      body: body(
        '**Negative Event Count** tallies displayable events with `polarity = −1`—lawsuits, downgrades, operational failures, regulatory actions, etc.',
        'Central for **downside protection** reviews: clients often hold names with accumulating negative headlines unaware of concentration.',
        'High negative count does not mandate sale—it mandates **conversation** and position-size review.',
        'Combine with Graham or Risk scores to prioritize which negatives matter fundamentally.',
      ),
    },
    release2: {
      title: 'Negative Events — Q1 2025 Watchlist',
      subtitle: 'Elevated negative headline flow entering the new year.',
      seo_title: 'Negative Event Count Q1 2025',
      seo_description:
        'Q1 2025 negative event update for headline risk and downside review.',
      body: body(
        '**Q1 2025** identifies securities with rising negative event counts—often regulatory, litigation, or guidance-related.',
        'Use as a **watchlist**, not an auto-sell list. Some negatives are transitory; others signal structural impairment.',
        'For **capital preservation** mandates, consider trimming names with persistent negative counts and weak balance sheets.',
        'See the release table for the highest negative-event securities.',
      ),
    },
  },

  taxonomy_structural_growth_3y: {
    release1: {
      title: 'Structural Growth (3Y) — Near-Term Secular Lens',
      subtitle: 'LLM-estimated 3-year structural growth by taxonomy node.',
      seo_title: 'Structural growth 3Y score',
      seo_description:
        'Forward-looking 3-year structural growth estimates for taxonomy nodes using LLM analysis.',
      body: body(
        '**Structural Growth (3Y)** estimates near-term secular growth at the taxonomy-node level using structured LLM analysis of industry drivers.',
        'The 3Y horizon emphasizes **execution visibility**—product cycles, adoption curves, and policy tailwinds over the next few years.',
        'Securities inherit node scores through taxonomy mapping; check mapping confidence on the formula hub.',
        'Use for growth allocation tilts, not for **capital preservation** core holdings.',
      ),
    },
    release2: {
      title: 'Structural Growth 3Y — Q1 2025 Node Refresh',
      subtitle: 'Taxonomy assumptions updated for AI, energy, and industrial automation.',
      seo_title: 'Structural growth 3Y Q1 2025',
      seo_description:
        'Q1 2025 refresh of 3-year structural growth taxonomy estimates.',
      body: body(
        '**Q1 2025** revises several node growth assumptions after capex and policy developments. AI infrastructure and grid-related nodes saw upward revisions.',
        'Downward revisions clustered where pricing pressure and oversupply risks increased.',
        'Compare 3Y to 5Y and 10Y horizons before building long-duration growth narratives.',
        'Review security-level mapped scores in the release table.',
      ),
    },
  },

  taxonomy_structural_growth_5y: {
    release1: {
      title: 'Structural Growth (5Y) — Medium-Term Secular Backbone',
      subtitle: 'Five-year structural growth estimates across taxonomy nodes.',
      seo_title: 'Structural growth 5Y score',
      seo_description:
        'Five-year forward structural growth estimates for taxonomy-driven security scoring.',
      body: body(
        '**Structural Growth (5Y)** balances near-term execution with medium-term **secular adoption** curves—often the backbone of the CAGR composite.',
        'Weights in the CAGR score (`0.30×5y`) reflect that many advisors plan on a 5-year capital market assumption horizon.',
        'Higher 5Y scores suit core growth sleeves; low scores flag structural headwinds even if short-term earnings look fine.',
        'Always cross-check with Net Exposure for macro headwinds.',
      ),
    },
    release2: {
      title: 'Structural Growth 5Y — January 2025 Revision',
      subtitle: 'Medium-term growth nodes recalibrated post policy shifts.',
      seo_title: 'Structural growth 5Y Jan 2025',
      seo_description:
        'January 2025 update to five-year structural growth taxonomy scores.',
      body: body(
        '**January 2025** medium-term revisions emphasize durability of demand drivers—not one-year hype cycles.',
        'Nodes tied to **capital efficiency** and automation rose; purely narrative themes without revenue linkage were trimmed.',
        'Use 5Y scores to anchor client education on *why* a theme might matter over a full market cycle.',
        'See mapped security rankings in this release.',
      ),
    },
  },

  taxonomy_structural_growth_10y: {
    release1: {
      title: 'Structural Growth (10Y) — Long-Duration Secular Bet',
      subtitle: 'Decade-scale structural growth for patient growth capital.',
      seo_title: 'Structural growth 10Y score',
      seo_description:
        'Ten-year structural growth estimates for long-horizon growth and thematic investing.',
      body: body(
        '**Structural Growth (10Y)** captures decade-scale adoption and TAM expansion—heavily weighted in the CAGR composite (`0.50×10y`).',
        'Appropriate for patient capital and thematic trusts; **not** for clients needing **low volatility** or near-term liquidity.',
        'Long-horizon estimates are inherently uncertain—use ranges and scenario language with clients.',
        'Pair with Wood or Druckenmiller committee subscores for security-level conviction.',
      ),
    },
    release2: {
      title: 'Structural Growth 10Y — Q1 2025 Long View',
      subtitle: 'Decade themes: energy transition, compute, demographics.',
      seo_title: 'Structural growth 10Y Q1 2025',
      seo_description:
        'Q1 2025 ten-year structural growth refresh for long-horizon thematic investors.',
      body: body(
        '**Q1 2025** long-view refresh stresses energy transition, compute infrastructure, and demographic healthcare demand.',
        'Themes without credible 10Y economics were downgraded even if 3Y momentum looked strong—avoiding **duration mismatch**.',
        'Document client time horizon before overweighting 10Y leaders.',
        'Consult the release rankings for current long-duration growth maps.',
      ),
    },
  },

  taxonomy_structural_growth_cagr_score: {
    release1: {
      title: 'Structural Growth CAGR Score — Blended Horizon Rank',
      subtitle: 'Weighted combination of 3Y, 5Y, and 10Y structural growth scores.',
      seo_title: 'Structural growth CAGR composite score',
      seo_description:
        'CAGR score blends 3Y, 5Y, and 10Y structural growth: 0.20×3y + 0.30×5y + 0.50×10y.',
      body: body(
        'The **Structural Growth CAGR Score** combines 3Y, 5Y, and 10Y node-level estimates: `0.20×score_3y + 0.30×score_5y + 0.50×score_10y`.',
        'It is the primary **taxonomy growth rank** for advisors who want one number without picking a single horizon.',
        'Emphasis on 10Y rewards durable secular themes; 3Y component prevents stale decade stories missing near-term inflection.',
        'For **capital preservation** clients, use this as an overlay—not a core holding filter.',
      ),
    },
    release2: {
      title: 'CAGR Score — Q1 2025 Composite Refresh',
      subtitle: 'All three horizons rolled forward with revised taxonomy weights.',
      seo_title: 'Structural growth CAGR Q1 2025',
      seo_description:
        'Q1 2025 structural growth CAGR composite with updated 3Y/5Y/10Y inputs.',
      body: body(
        '**Q1 2025** recomputes the CAGR composite after all horizon subscores refreshed. Rank changes often trace to **10Y assumption** updates more than quarterly earnings.',
        'Securities with rising CAGR but high negative event counts deserve extra diligence—growth and headline risk may conflict.',
        'Use alongside Fundamental Constriction for “growth with quality” combinations.',
        'See the blended ranking in the release securities table.',
      ),
    },
  },

  market_content_classifier: {
    release1: {
      title: 'Market Content Classifier — Events & News Pipeline',
      subtitle: 'LLM classification into market_content and entity links.',
      seo_title: 'Market content classifier',
      seo_description:
        'LLM pipeline classifying news and events into market_content and market_content_entities.',
      body: body(
        'The **Market Content Classifier** is the ingestion brain behind event-driven scores: it classifies raw news into `market_content` rows and links affected entities.',
        'Output JSON includes polarity, severity, materiality, and category tags consumed by Event Pressure and event count formulas.',
        'Quality here directly affects **headline risk** signals—garbage in, garbage out.',
        'Primarily an operator/engineering formula, not a client-facing buy list.',
      ),
    },
    release2: {
      title: 'Classifier — Q1 2025 Model & Taxonomy Tune',
      subtitle: 'Improved materiality calibration and category coverage.',
      seo_title: 'Market content classifier Q1 2025',
      seo_description:
        'Q1 2025 classifier update with improved materiality and category coverage.',
      body: body(
        '**Q1 2025** tuning reduces false-positive **negative** classifications on routine PR and improves **materiality** scoring for earnings surprises.',
        'Downstream Event Pressure and Political workflows inherit these improvements automatically.',
        'Operators should monitor classification QA samples after each prompt version bump.',
        'Documentation for schema and prompt keys lives on the formula hub.',
      ),
    },
  },
};

function getReleaseContent(formulaKey, variant) {
  const entry = CONTENT[formulaKey];
  if (!entry) {
    return null;
  }
  return entry[variant] ?? null;
}

function fallbackContent(formulaName, formulaKey, variant) {
  const isSecond = variant === 'release2';
  return {
    title: isSecond ? `${formulaName} — Q1 2025 Update` : `${formulaName} — Overview`,
    subtitle: isSecond
      ? 'Updated ranking and methodology notes for the current snapshot.'
      : 'How this formula ranks securities and how advisors use it in client portfolios.',
    seo_title: isSecond ? `${formulaName} Q1 2025` : formulaName,
    seo_description: `${formulaName}: quantitative ranking and advisor-oriented interpretation.`,
    body: body(
      `**${formulaName}** (${formulaKey}) ranks securities using the model documented on the Alpha Galangal formula hub.`,
      isSecond
        ? 'This **Q1 2025 refresh** updates factor inputs, universe coverage, and ranked results after the latest data pipeline run.'
        : 'This release explains what the score measures, how to interpret high vs low readings, and how it fits alongside other Alpha Galangal models.',
      'For **capital preservation** and **downside protection** workflows, pair this score with Graham, Buffett, or Hedge Fund Risk lenses before making allocation changes.',
      'See the ranked securities table below for the current snapshot.',
    ),
  };
}

module.exports = {
  CONTENT,
  getReleaseContent,
  fallbackContent,
};
