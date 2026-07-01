import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  CongressMemberDetailDto,
  CongressMemberDetailResponseDto,
  CongressMemberListItemDto,
  CongressServiceTermDto,
} from './dto';
import {
  CONGRESS_TERM_START_YEAR,
  getCurrentCongressNumber,
} from './congress-session.util';
import { CongressService } from './congress.service';

const ENTITY_TYPE_POLITICIAN = 'politician';
const MEMBER_PAGE_SIZE = 250;
const DELAY_MS_BETWEEN_DETAIL_CALLS = 250;

@Injectable()
export class CongressSyncService {
  private readonly logger = new Logger(CongressSyncService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(
    private config: ConfigService,
    private congressService: CongressService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  getCurrentCongress(): number {
    return getCurrentCongressNumber();
  }

  private getClient(): SupabaseClient {
    if (!this.adminClient) throw new Error('Supabase client not configured');
    return this.adminClient;
  }

  private async ensureEntity(bioguideId: string, name: string | null): Promise<string> {
    const client = this.getClient();
    const key = bioguideId;
    const { data: existing } = await client
      .from('entities')
      .select('id')
      .eq('entity_type', ENTITY_TYPE_POLITICIAN)
      .eq('key', key)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: inserted, error } = await client
      .from('entities')
      .insert({ entity_type: ENTITY_TYPE_POLITICIAN, key, name })
      .select('id')
      .single();
    if (error) throw new Error(`Entity insert failed: ${error.message}`);
    return inserted!.id;
  }

  private buildNameFull(m: CongressMemberDetailDto): string | null {
    if (m.name && String(m.name).trim()) return String(m.name).trim();
    const parts = [
      m.firstName,
      m.middleName,
      m.lastName,
      m.suffix ? String(m.suffix).replace(/^,?\s*/, '') : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' ').trim() : null;
  }

  private buildNameLastFirst(m: CongressMemberDetailDto): string | null {
    const last = m.lastName ?? '';
    const first = [m.firstName, m.middleName].filter(Boolean).join(' ');
    const suf = m.suffix ? `, ${m.suffix}` : '';
    if (!last && !first) return null;
    return `${last}, ${first}${suf}`.trim() || null;
  }

  private getTermsFromMember(member: CongressMemberDetailDto): CongressServiceTermDto[] {
    const terms = member.serviceTerms ?? member.directorialTerms ?? [];
    return Array.isArray(terms) ? terms : [];
  }

  private congressToYears(congress: number): { startYear: number; endYear: number } {
    const startYear = CONGRESS_TERM_START_YEAR + 2 * (congress - 1);
    return { startYear, endYear: startYear + 1 };
  }

  private mapTermToRow(
    bioguideId: string,
    t: CongressServiceTermDto,
  ): {
    bioguide_id: string;
    congress: number;
    chamber: string | null;
    member_type: string | null;
    state_code: string | null;
    state_name: string | null;
    district: string | null;
    party: string | null;
    party_code: string | null;
    start_year: number;
    end_year: number;
  } {
    const congress = Number(t.congress);
    const { startYear, endYear } = Number.isFinite(congress) && congress > 0
      ? this.congressToYears(congress)
      : { startYear: t.startYear ?? 0, endYear: t.endYear ?? 0 };
    const district = t.district != null ? String(t.district) : null;
    return {
      bioguide_id: bioguideId,
      congress: Number.isFinite(congress) ? congress : 0,
      chamber: t.chamber ? String(t.chamber) : null,
      member_type: t.type ? String(t.type) : null,
      state_code: (t.stateCode ?? t.state) ? String(t.stateCode ?? t.state) : null,
      state_name: t.state ? String(t.state) : null,
      district,
      party: t.party ? String(t.party) : null,
      party_code: t.partyCode ? String(t.partyCode) : null,
      start_year: startYear,
      end_year: endYear,
    };
  }

  async upsertPoliticianFromDetail(
    member: CongressMemberDetailDto,
    isCurrentMember: boolean,
  ): Promise<void> {
    const bioguideId = member.bioguideId ?? null;
    if (!bioguideId) {
      this.logger.warn('Member detail missing bioguideId, skipping');
      return;
    }
    const client = this.getClient();
    const nameFull = this.buildNameFull(member) ?? '';
    const entityId = await this.ensureEntity(bioguideId, nameFull || null);

    const contact = member.contact as { address?: string[]; phone?: string } | undefined;
    const contactAddress = Array.isArray(contact?.address)
      ? contact.address.join('; ')
      : Array.isArray(contact)
        ? contact.join('; ')
        : typeof contact === 'string'
          ? contact
          : null;
    const contactPhone = contact && typeof contact === 'object' && 'phone' in contact
      ? String(contact.phone ?? '')
      : null;

    const row = {
      entity_id: entityId,
      bioguide_id: bioguideId,
      first_name: member.firstName ? String(member.firstName) : null,
      middle_name: member.middleName ? String(member.middleName) : null,
      last_name: member.lastName ? String(member.lastName) : null,
      suffix: member.suffix ? String(member.suffix) : null,
      nickname: member.nickname ? String(member.nickname) : null,
      name_full: nameFull || null,
      name_last_first: this.buildNameLastFirst(member),
      is_current_member: isCurrentMember,
      current_party: member.serviceTerms?.[0]?.party ?? member.directorialTerms?.[0]?.party
        ? String((member.serviceTerms ?? member.directorialTerms)![0].party)
        : null,
      current_state: member.serviceTerms?.[0]?.state ?? member.directorialTerms?.[0]?.state
        ? String((member.serviceTerms ?? member.directorialTerms)![0].state ?? '')
        : null,
      current_district: (member.serviceTerms?.[0] ?? member.directorialTerms?.[0])?.district != null
        ? String((member.serviceTerms ?? member.directorialTerms)![0].district)
        : null,
      chamber: (member.serviceTerms?.[0] ?? member.directorialTerms?.[0])?.chamber
        ? String((member.serviceTerms ?? member.directorialTerms)![0].chamber)
        : null,
      official_website_url: member.officialWebsiteUrl ? String(member.officialWebsiteUrl) : null,
      updated_at_congress_gov: new Date().toISOString(),
      birth_year: member.birthYear != null ? Number(member.birthYear) : null,
      death_year: member.deathYear != null ? Number(member.deathYear) : null,
      honorific_name: member.honorificName ? String(member.honorificName) : null,
      portrait_url: member.portrait ? String(member.portrait) : null,
      portrait_source: null as string | null,
      contact_address: contactAddress || null,
      contact_phone: contactPhone || null,
      source: 'congress_gov',
    };

    const { error } = await client
      .from('politicians')
      .upsert(row, { onConflict: 'bioguide_id', ignoreDuplicates: false });
    if (error) throw new Error(`Politician upsert failed for ${bioguideId}: ${error.message}`);
  }

  async upsertPoliticianTermsFromDetail(member: CongressMemberDetailDto): Promise<void> {
    const bioguideId = member.bioguideId ?? null;
    if (!bioguideId) return;
    const client = this.getClient();
    const terms = this.getTermsFromMember(member);
    const rows = terms
      .filter((t) => t.congress != null || (t.startYear != null && t.endYear != null))
      .map((t) => this.mapTermToRow(bioguideId, t))
      .filter((r) => r.congress > 0 || r.start_year > 0);

    if (rows.length === 0) return;

    const { error: delErr } = await client
      .from('politician_terms')
      .delete()
      .eq('bioguide_id', bioguideId);
    if (delErr) throw new Error(`Politician terms delete failed for ${bioguideId}: ${delErr.message}`);

    const { error: insErr } = await client.from('politician_terms').insert(rows);
    if (insErr) throw new Error(`Politician terms insert failed for ${bioguideId}: ${insErr.message}`);
  }

  async syncMemberDetail(
    bioguideId: string,
    fetchDetail: (id: string) => Promise<CongressMemberDetailResponseDto>,
    isCurrentMember: boolean,
  ): Promise<void> {
    const res = await fetchDetail(bioguideId);
    const member = res?.member;
    if (!member) {
      this.logger.warn(`No member in response for ${bioguideId}`);
      return;
    }
    await this.upsertPoliticianFromDetail(member, isCurrentMember);
    await this.upsertPoliticianTermsFromDetail(member);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async syncCurrentMembers(): Promise<{ congress: number; synced: number; errors: number }> {
    const congress = this.getCurrentCongress();
    let offset = 0;
    let synced = 0;
    let errors = 0;
    const seen = new Set<string>();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const list = await this.congressService.getMembers({
        congress,
        limit: MEMBER_PAGE_SIZE,
        offset,
      });
      const members = (list.members ?? []) as CongressMemberListItemDto[];
      if (members.length === 0) break;

      for (const m of members) {
        const bioguideId = m.bioguideId ?? null;
        if (!bioguideId || seen.has(bioguideId)) continue;
        seen.add(bioguideId);
        try {
          await this.delay(DELAY_MS_BETWEEN_DETAIL_CALLS);
          await this.syncMemberDetail(
            bioguideId,
            (id) => this.congressService.getMemberByBioguideId(id),
            true,
          );
          synced++;
        } catch (e) {
          this.logger.warn(`Sync failed for ${bioguideId}: ${e instanceof Error ? e.message : e}`);
          errors++;
        }
      }

      const next = list.pagination?.next;
      if (!next || members.length < MEMBER_PAGE_SIZE) break;
      offset += MEMBER_PAGE_SIZE;
    }

    this.logger.log(`Sync complete: congress=${congress} synced=${synced} errors=${errors}`);
    return { congress, synced, errors };
  }
}
