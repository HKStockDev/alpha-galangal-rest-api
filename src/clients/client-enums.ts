export const CLIENT_TYPES = ['family_individual', 'business'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const RELATIONSHIP_ROLES = [
  'primary_client',
  'spouse_partner',
  'dependent_child',
  'trust_entity',
  'business_plan',
  'other',
] as const;
export type RelationshipRole = (typeof RELATIONSHIP_ROLES)[number];

export const TIME_HORIZONS = ['short_term', 'medium_term', 'long_term'] as const;
export type TimeHorizon = (typeof TIME_HORIZONS)[number];

export const LIQUIDITY_NEEDS = ['none_low', 'moderate', 'high'] as const;
export type LiquidityNeeds = (typeof LIQUIDITY_NEEDS)[number];

export const INVESTMENT_OBJECTIVES = [
  'growth_capital_appreciation',
  'income_yield_generation',
  'preservation_of_capital',
  'retirement_income',
  'education_funding',
  'legacy_estate_planning',
  'business_succession_corporate_reserves',
] as const;
export type InvestmentObjective = (typeof INVESTMENT_OBJECTIVES)[number];

export const TAX_ACCOUNT_TYPES = [
  'taxable_brokerage',
  'tax_deferred_ira_401k',
  'tax_free_roth',
  'trust_revocable_irrevocable',
  'business_entity_account',
  'other',
] as const;
export type TaxAccountType = (typeof TAX_ACCOUNT_TYPES)[number];

export const SPECIAL_PREFERENCE_TAGS = [
  'esg_sustainable_impact',
  'avoid_certain_sectors',
  'dividend_focus',
  'low_volatility_low_beta',
  'high_growth_tech_heavy',
  'international_exposure_limit',
  'no_alternatives_illiquids',
] as const;
export type SpecialPreferenceTag = (typeof SPECIAL_PREFERENCE_TAGS)[number];

export const CLIENT_ENTITY_TYPES = ['individual', 'company', 'trust', 'joint', 'other'] as const;
export type ClientEntityType = (typeof CLIENT_ENTITY_TYPES)[number];

export const CLIENT_KYC_STATUSES = [
  'not_started',
  'pending',
  'verified',
  'rejected',
  'expired',
] as const;
export type ClientKycStatus = (typeof CLIENT_KYC_STATUSES)[number];

export const CLIENT_ONBOARDING_STATUSES = [
  'draft',
  'in_progress',
  'completed',
  'blocked',
] as const;
export type ClientOnboardingStatus = (typeof CLIENT_ONBOARDING_STATUSES)[number];

export const CLIENT_STATUSES = ['active', 'inactive', 'suspended', 'closed'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_AML_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type ClientAmlRiskLevel = (typeof CLIENT_AML_RISK_LEVELS)[number];
