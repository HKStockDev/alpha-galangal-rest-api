/**
 * Mirrors src/stock-ingest-filters/ingest-filter-evaluator.ts for Node scripts.
 * Update both when ingest rules change.
 */
'use strict';

const DEFAULT_FILTERS_ROW = {
  singleton_key: 'default',
  exchanges: [],
  security_types: [],
  countries: [],
  min_market_cap_usd: null,
  min_avg_share_volume: null,
  min_price_usd: null,
  min_avg_dollar_volume_usd: null,
};

function defaultPlatformIngestFilters() {
  return { ...DEFAULT_FILTERS_ROW };
}

function canonicalExchangeFromProfile(exchangeShortName, exchange) {
  const raw = (exchangeShortName ?? exchange ?? '').trim();
  if (!raw) return null;
  const u = raw.toUpperCase();
  if (u.includes('NASDAQ') || u === 'NMS' || u === 'NGM' || u === 'NASD') {
    return 'NASDAQ';
  }
  if (u.includes('NYSE AMERICAN') || u === 'AMEX' || u === 'NYSE MKT') {
    return 'AMEX';
  }
  if (u.includes('NYSE') || u === 'ARCA' || u === 'NYSE ARCA') {
    return 'NYSE';
  }
  if (
    u.includes('OTC') ||
    u === 'PINK' ||
    u.includes('OTCQB') ||
    u.includes('OTCQX') ||
    u === 'OTCM'
  ) {
    return 'OTC';
  }
  return u;
}

function canonicalCountryFromProfile(country) {
  if (country == null || String(country).trim() === '') return null;
  const u = String(country).trim().toUpperCase();
  const map = {
    US: 'USA',
    USA: 'USA',
    'UNITED STATES': 'USA',
    'UNITED STATES OF AMERICA': 'USA',
    CA: 'Canada',
    CANADA: 'Canada',
    GB: 'UK',
    UK: 'UK',
    'UNITED KINGDOM': 'UK',
    DE: 'Germany',
    GERMANY: 'Germany',
    CN: 'China',
    CHINA: 'China',
    JP: 'Japan',
    JAPAN: 'Japan',
    AU: 'Australia',
    AUSTRALIA: 'Australia',
  };
  return map[u] ?? String(country).trim();
}

function classifyIngestSecurityType(profile) {
  const sym = String(profile.symbol ?? '').toUpperCase();
  const name = String(profile.companyName ?? '').toUpperCase();
  const industry = String(profile.industry ?? '').toUpperCase();
  const sector = String(profile.sector ?? '').toUpperCase();

  if (profile.isEtf === true) return 'ETF';
  if (profile.isAdr === true) return 'ADR';
  if (profile.isFund === true) {
    if (
      industry.includes('CLOSED-END') ||
      name.includes('CLOSED-END') ||
      industry.includes('CLOSED END')
    ) {
      return 'CLOSED_END_FUND';
    }
    return 'MUTUAL_FUND';
  }
  if (industry.includes('REIT') || sector.includes('REIT')) return 'REIT';
  if (name.includes(' SPAC') || industry.includes('SPAC')) return 'SPAC';

  const t = String(profile.type ?? profile.stockType ?? '').toUpperCase();
  if (t.includes('WARRANT')) return 'WARRANT';
  if (t.includes('PREFERRED') || t.includes('PRFD')) return 'PREFERRED';
  if (t.includes('UNIT')) return 'UNIT';
  if (t.includes('CRYPTO') || t.includes('DIGITAL')) return 'CRYPTO';
  if (sym.startsWith('^')) return 'INDEX';

  return 'COMMON_STOCK';
}

const TYPE_TO_CODE = {
  COMMON_STOCK: 'CS',
  ETF: 'ETF',
  REIT: 'REIT',
  SPAC: 'SPAC',
  ADR: 'ADR',
  PREFERRED: 'PRF',
  WARRANT: 'WARRANT',
  UNIT: 'UNIT',
  CLOSED_END_FUND: 'CEF',
  MUTUAL_FUND: 'MF',
  INDEX: 'IDX',
  CRYPTO: 'CRYPTO',
};

function ingestSecurityTypeToTypeCode(t) {
  return TYPE_TO_CODE[t] ?? 'CS';
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildIngestSnapshotFromProfile(profile) {
  const priceUsd = numOrNull(profile.price);
  const vol = numOrNull(profile.volAvg);
  const mcap = numOrNull(profile.marketCap);
  let avgDollarVolume = null;
  if (priceUsd != null && vol != null) {
    avgDollarVolume = priceUsd * vol;
  }
  return {
    canonicalExchange: canonicalExchangeFromProfile(
      profile.exchangeShortName != null ? String(profile.exchangeShortName) : null,
      profile.exchange != null ? String(profile.exchange) : null,
    ),
    canonicalCountry: canonicalCountryFromProfile(
      profile.country != null ? String(profile.country) : null,
    ),
    securityType: classifyIngestSecurityType(profile),
    marketCapUsd: mcap,
    avgShareVolume: vol,
    priceUsd,
    avgDollarVolumeUsd: avgDollarVolume,
  };
}

function exchangeMatchesAllowed(canonical, allowed) {
  if (!allowed.length) return true;
  if (!canonical) return false;
  const cu = canonical.toUpperCase();
  return allowed.some((a) => a.toUpperCase() === cu);
}

function listMatchesAllowed(value, allowed) {
  if (!allowed.length) return true;
  if (!value) return false;
  const vu = value.toUpperCase();
  return allowed.some((a) => a.toUpperCase() === vu);
}

function evaluateIngestAgainstFilters(filters, snap) {
  const f = filters ?? DEFAULT_FILTERS_ROW;

  if (
    f.exchanges.length > 0 &&
    !exchangeMatchesAllowed(snap.canonicalExchange, f.exchanges)
  ) {
    return {
      ok: false,
      reason: `Exchange not allowed (got ${snap.canonicalExchange ?? 'unknown'}, allowed ${f.exchanges.join(', ')})`,
    };
  }

  if (
    f.security_types.length > 0 &&
    !f.security_types.some((t) => t === snap.securityType)
  ) {
    return {
      ok: false,
      reason: `Security type ${snap.securityType} not in allowed list`,
    };
  }

  if (
    f.countries.length > 0 &&
    !listMatchesAllowed(snap.canonicalCountry, f.countries)
  ) {
    return {
      ok: false,
      reason: `Country not allowed (got ${snap.canonicalCountry ?? 'unknown'})`,
    };
  }

  if (f.min_market_cap_usd != null) {
    if (snap.marketCapUsd == null) {
      return { ok: false, reason: 'Market cap unknown but minimum is set' };
    }
    if (snap.marketCapUsd < f.min_market_cap_usd) {
      return {
        ok: false,
        reason: `Market cap ${snap.marketCapUsd} below minimum ${f.min_market_cap_usd}`,
      };
    }
  }

  if (f.min_avg_share_volume != null) {
    if (snap.avgShareVolume == null) {
      return { ok: false, reason: 'Average volume unknown but minimum is set' };
    }
    if (snap.avgShareVolume + 1e-9 < f.min_avg_share_volume) {
      return {
        ok: false,
        reason: `Average volume ${snap.avgShareVolume} below minimum ${f.min_avg_share_volume}`,
      };
    }
  }

  if (f.min_price_usd != null) {
    if (snap.priceUsd == null) {
      return { ok: false, reason: 'Price unknown but minimum is set' };
    }
    if (snap.priceUsd + 1e-9 < f.min_price_usd) {
      return {
        ok: false,
        reason: `Price ${snap.priceUsd} below minimum ${f.min_price_usd}`,
      };
    }
  }

  if (f.min_avg_dollar_volume_usd != null) {
    if (snap.avgDollarVolumeUsd == null) {
      return {
        ok: false,
        reason: 'Average dollar volume unknown but minimum is set',
      };
    }
    if (snap.avgDollarVolumeUsd + 1e-6 < f.min_avg_dollar_volume_usd) {
      return {
        ok: false,
        reason: `Average dollar volume ${snap.avgDollarVolumeUsd} below minimum ${f.min_avg_dollar_volume_usd}`,
      };
    }
  }

  return { ok: true };
}

module.exports = {
  defaultPlatformIngestFilters,
  canonicalExchangeFromProfile,
  canonicalCountryFromProfile,
  classifyIngestSecurityType,
  ingestSecurityTypeToTypeCode,
  buildIngestSnapshotFromProfile,
  evaluateIngestAgainstFilters,
};
