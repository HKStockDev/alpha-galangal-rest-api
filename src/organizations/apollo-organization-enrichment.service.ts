import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ApolloOrganization = Record<string, unknown>;

@Injectable()
export class ApolloOrganizationEnrichmentService {
  private readonly logger = new Logger(ApolloOrganizationEnrichmentService.name);

  constructor(private readonly config: ConfigService) {}

  normalizeDomain(input: string): string {
    let s = input.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '');
    s = s.split('/')[0] ?? s;
    s = s.split('@').pop() ?? s;
    if (s.startsWith('www.')) {
      s = s.slice(4);
    }
    return s.trim();
  }

  mapApolloOrganizationToPatch(
    org: ApolloOrganization,
    rawResponse: Record<string, unknown>,
  ): Record<string, unknown> {
    const phone = this.extractPhone(org);
    const desc =
      (typeof org.short_description === 'string' && org.short_description.trim()) ||
      (typeof org.seo_description === 'string' && org.seo_description.trim()) ||
      null;

    return {
      legal_name: typeof org.name === 'string' ? org.name : null,
      domain: typeof org.primary_domain === 'string' ? org.primary_domain.toLowerCase() : null,
      website_url: typeof org.website_url === 'string' ? org.website_url : null,
      linkedin_url: typeof org.linkedin_url === 'string' ? org.linkedin_url : null,
      logo_url: typeof org.logo_url === 'string' ? org.logo_url : null,
      phone,
      description: desc,
      industry: typeof org.industry === 'string' ? org.industry : null,
      estimated_num_employees:
        typeof org.estimated_num_employees === 'number' ? org.estimated_num_employees : null,
      founded_year: typeof org.founded_year === 'number' ? org.founded_year : null,
      country: typeof org.country === 'string' ? org.country : null,
      region: typeof org.state === 'string' ? org.state : null,
      city: typeof org.city === 'string' ? org.city : null,
      address_line1: typeof org.street_address === 'string' ? org.street_address : null,
      postal_code: typeof org.postal_code === 'string' ? org.postal_code : null,
      raw_address: typeof org.raw_address === 'string' ? org.raw_address : null,
      external_provider_id: org.id != null ? String(org.id) : null,
      enriched_at: new Date().toISOString(),
      enrichment_source: 'apollo',
      enrichment_raw_json: rawResponse,
    };
  }

  async fetchOrganizationByDomain(domain: string): Promise<{
    organization: ApolloOrganization;
    raw: Record<string, unknown>;
  }> {
    const apiKey = this.config.get<string>('apollo.apiKey');
    if (!apiKey) {
      throw new BadRequestException('Apollo API is not configured (APOLLO_API_KEY)');
    }

    const base =
      this.config.get<string>('apollo.baseUrl')?.replace(/\/$/, '') ??
      'https://api.apollo.io/api/v1';
    const url = new URL(`${base}/organizations/enrich`);
    url.searchParams.set('domain', domain);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    });

    const raw = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const msg =
        typeof raw.error === 'string'
          ? raw.error
          : typeof raw.message === 'string'
            ? raw.message
            : `Apollo request failed (${res.status})`;
      this.logger.warn(`Apollo enrich failed: ${msg}`);
      throw new BadRequestException(msg);
    }

    const organization = raw.organization as ApolloOrganization | undefined | null;
    if (!organization || typeof organization !== 'object') {
      throw new BadRequestException('No organization found for this domain');
    }

    return { organization, raw };
  }

  private extractPhone(org: ApolloOrganization): string | null {
    if (typeof org.phone === 'string' && org.phone.trim()) {
      return org.phone.trim();
    }
    const pp = org.primary_phone;
    if (pp && typeof pp === 'object' && pp !== null) {
      const n = (pp as { number?: string; sanitized_number?: string }).sanitized_number;
      if (typeof n === 'string' && n.trim()) return n.trim();
      const m = (pp as { number?: string }).number;
      if (typeof m === 'string' && m.trim()) return m.trim();
    }
    return null;
  }
}
