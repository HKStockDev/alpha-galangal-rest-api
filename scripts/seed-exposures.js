/**
 * Seeds the exposures table from the v1 core exposures expanded dictionary.
 * Usage: node scripts/seed-exposures.js
 */
require('dotenv').config({ path: '.env.development' });
const { Client } = require('pg');

const DATA = {
  version: 'v1_core_exposures_expanded',
  description: 'Macro, demand, supply chain, regulatory, and capital cycle exposures for securities modeling.',
  exposures: [
    { name: 'Interest Rates Level', slug: 'interest_rates_level', category: 'macro', description: 'Sensitivity to changes in nominal interest rates.' },
    { name: 'Interest Rate Volatility', slug: 'interest_rate_volatility', category: 'macro', description: 'Sensitivity to volatility in rates markets.' },
    { name: 'Inflation (CPI)', slug: 'inflation_cpi', category: 'macro', description: 'Sensitivity to consumer price inflation.' },
    { name: 'Producer Inflation (PPI)', slug: 'inflation_ppi', category: 'macro', description: 'Sensitivity to input cost inflation.' },
    { name: 'USD Strength', slug: 'usd_strength', category: 'macro', description: 'Sensitivity to US dollar appreciation.' },
    { name: 'Oil Prices', slug: 'oil_prices', category: 'macro', description: 'Sensitivity to crude oil prices.' },
    { name: 'Natural Gas Prices', slug: 'natural_gas_prices', category: 'macro', description: 'Sensitivity to natural gas pricing.' },
    { name: 'Copper Prices', slug: 'copper_prices', category: 'macro', description: 'Sensitivity to copper prices.' },
    { name: 'Gold Prices', slug: 'gold_prices', category: 'macro', description: 'Sensitivity to gold prices.' },
    { name: 'Credit Spreads', slug: 'credit_spreads', category: 'macro', description: 'Sensitivity to widening or tightening credit spreads.' },
    { name: 'Housing Market Activity', slug: 'housing_market_activity', category: 'macro', description: 'Exposure to housing construction and home sales.' },
    { name: 'Consumer Confidence', slug: 'consumer_confidence', category: 'macro', description: 'Sensitivity to consumer sentiment levels.' },
    { name: 'Unemployment Rate', slug: 'unemployment_rate', category: 'macro', description: 'Sensitivity to labor market conditions.' },
    { name: 'Enterprise IT Spending', slug: 'enterprise_it_spending', category: 'demand_driver', description: 'Exposure to enterprise technology budgets.' },
    { name: 'Hyperscaler Capex', slug: 'hyperscaler_capex', category: 'demand_driver', description: 'Exposure to hyperscaler data center spending.' },
    { name: 'AI Infrastructure Capex', slug: 'ai_infrastructure_capex', category: 'demand_driver', description: 'Exposure to AI hardware and infrastructure spending.' },
    { name: 'Semiconductor Cycle', slug: 'semiconductor_cycle', category: 'demand_driver', description: 'Exposure to semiconductor up/down cycle.' },
    { name: 'Defense Spending', slug: 'defense_spending', category: 'demand_driver', description: 'Exposure to military and defense budgets.' },
    { name: 'Healthcare Innovation Spending', slug: 'healthcare_innovation_spending', category: 'demand_driver', description: 'Exposure to biotech and medical R&D growth.' },
    { name: 'Infrastructure Spending', slug: 'infrastructure_spending', category: 'demand_driver', description: 'Exposure to public infrastructure programs.' },
    { name: 'Automotive Electrification', slug: 'automotive_electrification', category: 'demand_driver', description: 'Exposure to EV and electrification trends.' },
    { name: 'Industrial Automation Investment', slug: 'industrial_automation_investment', category: 'demand_driver', description: 'Exposure to robotics and factory automation growth.' },
    { name: 'E-Commerce Penetration', slug: 'ecommerce_penetration', category: 'demand_driver', description: 'Exposure to online retail adoption.' },
    { name: 'Digital Advertising Spend', slug: 'digital_ad_spend', category: 'demand_driver', description: 'Exposure to digital advertising budgets.' },
    { name: 'NVIDIA Dependency', slug: 'nvidia_dependency', category: 'supply_chain', description: 'Reliance on NVIDIA GPUs or ecosystem.' },
    { name: 'TSMC Dependency', slug: 'tsmc_dependency', category: 'supply_chain', description: 'Reliance on TSMC fabrication capacity.' },
    { name: 'China Manufacturing Exposure', slug: 'china_manufacturing_exposure', category: 'supply_chain', description: 'Dependence on Chinese manufacturing base.' },
    { name: 'Rare Earth Materials', slug: 'rare_earth_materials', category: 'supply_chain', description: 'Dependence on rare earth inputs.' },
    { name: 'Lithium Supply', slug: 'lithium_supply', category: 'supply_chain', description: 'Dependence on lithium inputs.' },
    { name: 'Semiconductor Equipment Bottlenecks', slug: 'semicap_bottlenecks', category: 'supply_chain', description: 'Sensitivity to chip manufacturing constraints.' },
    { name: 'Capex Supercycle', slug: 'capex_supercycle', category: 'capital_cycle', description: 'Beneficiary of broad capital expenditure expansion.' },
    { name: 'Margin Expansion Cycle', slug: 'margin_expansion_cycle', category: 'capital_cycle', description: 'Exposure to operating leverage improvement cycles.' },
    { name: 'Pricing Power Cycle', slug: 'pricing_power_cycle', category: 'capital_cycle', description: 'Ability to raise prices in inflationary environments.' },
    { name: 'Credit Expansion Cycle', slug: 'credit_expansion_cycle', category: 'capital_cycle', description: 'Beneficiary of expanding credit conditions.' },
    { name: 'Antitrust Risk', slug: 'antitrust_risk', category: 'regulatory', description: 'Exposure to antitrust enforcement actions.' },
    { name: 'Healthcare Reimbursement Policy', slug: 'healthcare_reimbursement_policy', category: 'regulatory', description: 'Exposure to Medicare/insurance reimbursement decisions.' },
    { name: 'Export Controls', slug: 'export_controls', category: 'regulatory', description: 'Exposure to export restriction regimes.' },
    { name: 'Environmental Regulation', slug: 'environmental_regulation', category: 'regulatory', description: 'Exposure to environmental policy changes.' },
    { name: 'Defense Procurement Policy', slug: 'defense_procurement_policy', category: 'regulatory', description: 'Exposure to government procurement changes.' },
    { name: 'AI Adoption Curve', slug: 'ai_adoption_curve', category: 'structural_shift', description: 'Exposure to accelerating AI adoption.' },
    { name: 'Energy Transition', slug: 'energy_transition', category: 'structural_shift', description: 'Exposure to decarbonization trends.' },
    { name: 'Reindustrialization', slug: 'reindustrialization', category: 'structural_shift', description: 'Exposure to domestic manufacturing resurgence.' },
    { name: 'Aging Population', slug: 'aging_population', category: 'structural_shift', description: 'Beneficiary of demographic aging trends.' },
    { name: 'Urbanization in Emerging Markets', slug: 'emerging_market_urbanization', category: 'structural_shift', description: 'Exposure to EM infrastructure buildout.' },
  ],
};

async function main() {
  const projectRef = process.env.SUPABASE_PROJECT_ID || new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const client = new Client({
    host: 'db.' + projectRef + '.supabase.co',
    port: 5432,
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  let count = 0;
  for (const e of DATA.exposures) {
    const name = (e.name ?? '').trim();
    const slug = (e.slug ?? '').trim();
    const category = (e.category ?? '').trim();
    if (!name || !slug || !category) continue;
    await client.query(
      `INSERT INTO exposures (name, slug, category, description, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         updated_at = now()`,
      [name, slug, category, e.description ?? null]
    );
    count++;
  }
  console.log('Done. Exposures seeded:', count);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
