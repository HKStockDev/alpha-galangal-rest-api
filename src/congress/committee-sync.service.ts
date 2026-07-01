import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  CongressCommitteeListItemDto,
  CongressCommitteeSubcommitteeDto,
} from './dto';
import { CongressService } from './congress.service';

const CONGRESS_TERM_START_YEAR = 1789;
const COMMITTEE_PAGE_SIZE = 250;

const CHAMBER_MAP: Record<string, 'house' | 'senate' | 'joint'> = {
  house: 'house',
  House: 'house',
  senate: 'senate',
  Senate: 'senate',
  joint: 'joint',
  Joint: 'joint',
};

const ENTITY_TYPE_COMMITTEE = 'committee';

const COMMITTEE_TYPE_VALUES = new Set([
  'Standing',
  'Select',
  'Special',
  'Joint',
  'Subcommittee',
  'Task Force',
  'Commission or Caucus',
  'Other',
]);

function normalizeChamber(chamber: string | undefined): 'house' | 'senate' | 'joint' | null {
  if (!chamber) return null;
  const v = CHAMBER_MAP[chamber];
  return v ?? null;
}

function normalizeType(type: string | undefined, isSubcommittee: boolean): string | null {
  if (isSubcommittee) return 'Subcommittee';
  if (!type) return null;
  return COMMITTEE_TYPE_VALUES.has(type) ? type : null;
}

function normalizeSystemCode(code: string | undefined): string | null {
  if (!code || typeof code !== 'string') return null;
  let lower = code.trim().toLowerCase();
  const m = lower.match(/^(h|s|j)([a-z0-9]{2,10}[0-9]{2})$/);
  if (m) {
    const prefix = { h: 'hs', s: 'ss', j: 'js' }[m[1] as string];
    lower = prefix + m[2];
  }
  if (!/^(hs|ss|js)[a-z0-9]{2,10}[0-9]{2}$/.test(lower)) return null;
  return lower;
}

@Injectable()
export class CommitteeSyncService {
  private readonly logger = new Logger(CommitteeSyncService.name);
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
    const year = new Date().getFullYear();
    return Math.floor((year - CONGRESS_TERM_START_YEAR) / 2) + 1;
  }

  private getClient(): SupabaseClient {
    if (!this.adminClient) throw new Error('Supabase client not configured');
    return this.adminClient;
  }

  private async ensureCommitteeEntity(systemCode: string, name: string): Promise<string> {
    const client = this.getClient();
    const key = systemCode;
    const { data: existing } = await client
      .from('entities')
      .select('id')
      .eq('entity_type', ENTITY_TYPE_COMMITTEE)
      .eq('key', key)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: inserted, error } = await client
      .from('entities')
      .insert({ entity_type: ENTITY_TYPE_COMMITTEE, key, name: name || key })
      .select('id')
      .single();
    if (error) throw new Error(`Entity insert failed: ${error.message}`);
    return inserted.id;
  }

  private committeeRow(
    systemCode: string,
    name: string,
    chamber: 'house' | 'senate' | 'joint',
    committeeType: string,
    entityId: string,
    isActive: boolean = true,
    updateDate: string | null = null,
    sourcePayload: Record<string, unknown> | null = null,
  ) {
    return {
      system_code: systemCode,
      name: name.trim() || systemCode,
      chamber,
      committee_type: committeeType,
      is_active: isActive,
      update_date: updateDate,
      source: 'congress_gov',
      source_payload: sourcePayload,
      updated_at: new Date().toISOString(),
      entity_id: entityId,
    };
  }

  private async upsertCommittee(row: ReturnType<CommitteeSyncService['committeeRow']>): Promise<void> {
    const client = this.getClient();
    const { error } = await client
      .from('committees')
      .upsert(row, { onConflict: 'system_code', ignoreDuplicates: false });
    if (error) throw new Error(`Committee upsert failed for ${row.system_code}: ${error.message}`);
  }

  async syncCommitteesForCongress(congress: number): Promise<{ synced: number; errors: number }> {
    let offset = 0;
    let synced = 0;
    let errors = 0;
    const seen = new Set<string>();

    for (;;) {
      const list = await this.congressService.getCommitteesByCongress(congress, {
        limit: COMMITTEE_PAGE_SIZE,
        offset,
      });
      const committees = list.committees ?? [];
      if (committees.length === 0) break;

      for (const item of committees as CongressCommitteeListItemDto[]) {
        const systemCode = normalizeSystemCode(item.systemCode);
        if (!systemCode || seen.has(systemCode)) continue;
        const chamber = normalizeChamber(item.chamber);
        const rawType = (item as { committeeTypeCode?: string }).committeeTypeCode ?? item.type;
        const type = normalizeType(rawType, false);
        if (!chamber || !type) {
          this.logger.warn(`Skipping committee ${item.systemCode}: missing chamber or type`);
          continue;
        }
        const name = (item.name ?? '').trim() || systemCode;
        seen.add(systemCode);
        const isSubcommittee = systemCode.slice(-2) !== '00';
        const committeeType = isSubcommittee ? 'Subcommittee' : type;
        try {
          const entityId = await this.ensureCommitteeEntity(systemCode, name);
          await this.upsertCommittee(
            this.committeeRow(systemCode, name, chamber, committeeType, entityId, true, null, item as unknown as Record<string, unknown>),
          );
          synced++;
        } catch (e) {
          this.logger.warn(`Sync failed for committee ${systemCode}: ${e instanceof Error ? e.message : e}`);
          errors++;
        }

        const subcommittees = (item.subcommittees ?? []) as CongressCommitteeSubcommitteeDto[];
        for (const sub of subcommittees) {
          const subCode = normalizeSystemCode(sub.systemCode);
          if (!subCode || seen.has(subCode)) continue;
          seen.add(subCode);
          const subName = (sub.name ?? '').trim() || subCode;
          const subIsSub = subCode.slice(-2) !== '00';
          const subType = subIsSub ? 'Subcommittee' : (normalizeType((sub as { committeeTypeCode?: string; type?: string }).committeeTypeCode ?? (sub as { type?: string }).type, false) ?? 'Subcommittee');
          try {
            const subEntityId = await this.ensureCommitteeEntity(subCode, subName);
            await this.upsertCommittee(
              this.committeeRow(subCode, subName, chamber, subType, subEntityId, true, null, sub as unknown as Record<string, unknown>),
            );
            synced++;
          } catch (e) {
            this.logger.warn(`Sync failed for subcommittee ${subCode}: ${e instanceof Error ? e.message : e}`);
            errors++;
          }
        }
      }

      if (committees.length < COMMITTEE_PAGE_SIZE) break;
      offset += COMMITTEE_PAGE_SIZE;
    }

    this.logger.log(`Committee sync complete: congress=${congress} synced=${synced} errors=${errors}`);
    return { synced, errors };
  }

  async syncCurrentCommittees(): Promise<{ congress: number; synced: number; errors: number }> {
    const congress = this.getCurrentCongress();
    const { synced, errors } = await this.syncCommitteesForCongress(congress);
    return { congress, synced, errors };
  }
}
