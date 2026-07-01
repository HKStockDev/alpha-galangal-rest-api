import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { load as yamlLoad } from 'js-yaml';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getCurrentCongressNumber } from './congress-session.util';

const YAML_URL =
  'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml';

type CommitteeRole =
  | 'chair'
  | 'ranking_member'
  | 'vice_chair'
  | 'member'
  | 'ex_officio'
  | 'other';

function normalizeCommitteeCode(code: string): string | null {
  const lower = code.trim().toLowerCase();
  if (/^(hs|ss|js)[a-z0-9]{2,10}[0-9]{2}$/.test(lower)) return lower;
  if (/^(hs|ss|js)[a-z]{2,8}$/.test(lower)) return `${lower}00`;
  return null;
}

function committeeCodeForDb(
  normalizedCode: string,
  validCodes: Set<string>,
): string {
  if (!validCodes.has(normalizedCode)) {
    const prefix = normalizedCode.slice(0, 2);
    const rest = normalizedCode.slice(2);
    const alternate =
      prefix && rest ? prefix + prefix.charAt(1) + rest : null;
    if (alternate && validCodes.has(alternate)) return alternate;
  }
  return normalizedCode;
}

function mapTitleToRole(title: string | undefined): CommitteeRole {
  if (!title || typeof title !== 'string') return 'member';
  const t = title.toLowerCase();
  if (t.includes('chair') && !t.includes('ranking') && !t.includes('vice')) return 'chair';
  if (t.includes('ranking member')) return 'ranking_member';
  if (t.includes('vice chair') || t.includes('vice chairman')) return 'vice_chair';
  if (t.includes('ex officio')) return 'ex_officio';
  if (t.includes('cochairman') || t.includes('co-chairman')) return 'chair';
  return 'member';
}

function membershipKey(r: { bioguide_id: string; committee_system_code: string }): string {
  return `${r.bioguide_id}|${r.committee_system_code}`;
}

@Injectable()
export class CommitteeMembershipSyncService {
  private readonly logger = new Logger(CommitteeMembershipSyncService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private getClient(): SupabaseClient {
    if (!this.adminClient) throw new Error('Supabase client not configured');
    return this.adminClient;
  }

  /**
   * Fetch unitedstates/congress-legislators committee-membership-current.yaml and
   * upsert into politician_committee_memberships (requires committees + politicians).
   */
  async syncFromYaml(): Promise<{
    congress: number;
    upserted: number;
    removed: number;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    const client = this.getClient();
    const congress = getCurrentCongressNumber();

    const res = await fetch(YAML_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch committee membership YAML: ${res.status}`);
    }
    const text = await res.text();
    const parsed = yamlLoad(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid committee membership YAML');
    }

    const { data: existingCommittees } = await client
      .from('committees')
      .select('system_code');
    const validCodes = new Set(
      (existingCommittees ?? []).map((r: { system_code: string }) => r.system_code),
    );

    let skippedNoCode = 0;

    const rows: {
      bioguide_id: string;
      committee_system_code: string;
      congress: number;
      role: CommitteeRole;
      member_rank: number | null;
      committee_party: 'majority' | 'minority' | null;
      source: string;
    }[] = [];

    for (const [code, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      const systemCode = normalizeCommitteeCode(code);
      if (!systemCode) {
        skippedNoCode++;
        continue;
      }
      const dbCode = committeeCodeForDb(systemCode, validCodes);
      for (const m of list) {
        if (!m || typeof m !== 'object' || !('bioguide' in m)) continue;
        const raw = m as Record<string, unknown>;
        const bioguide = typeof raw.bioguide === 'string' ? raw.bioguide.trim() : '';
        if (!bioguide) continue;
        const role = mapTitleToRole(
          typeof raw.title === 'string' ? raw.title : undefined,
        );
        const memberRank =
          typeof raw.rank === 'number' && raw.rank >= 1 ? raw.rank : null;
        const committeeParty =
          raw.party === 'majority' || raw.party === 'minority'
            ? raw.party
            : null;
        rows.push({
          bioguide_id: bioguide,
          committee_system_code: dbCode,
          congress,
          role,
          member_rank: memberRank,
          committee_party: committeeParty,
          source: 'congress_legislators_yaml',
        });
      }
    }

    if (rows.length === 0 && skippedNoCode > 0) {
      warnings.push(
        `No membership rows built (skipped ${skippedNoCode} YAML keys with unparseable committee codes). Run sync-committees first.`,
      );
    }

    const validRows = rows.filter((r) => validCodes.has(r.committee_system_code));
    if (validRows.length < rows.length) {
      warnings.push(
        `Dropped ${rows.length - validRows.length} rows: committee_system_code not in committees table.`,
      );
    }

    const bioguideIds = [...new Set(validRows.map((r) => r.bioguide_id))];
    const politicianIdByBioguide = new Map<string, string>();
    if (bioguideIds.length > 0) {
      const { data: politicians } = await client
        .from('politicians')
        .select('id, bioguide_id')
        .in('bioguide_id', bioguideIds);
      for (const p of politicians ?? []) {
        if (p.bioguide_id) politicianIdByBioguide.set(p.bioguide_id, p.id);
      }
    }

    const rowsWithPolitician: (typeof validRows[number] & { politician_id: string })[] =
      [];
    for (const r of validRows) {
      const pid = politicianIdByBioguide.get(r.bioguide_id);
      if (pid) rowsWithPolitician.push({ ...r, politician_id: pid });
    }
    if (rowsWithPolitician.length < validRows.length) {
      warnings.push(
        `Skipped ${validRows.length - rowsWithPolitician.length} rows: bioguide_id not in politicians (run Congress member sync first).`,
      );
    }

    if (rowsWithPolitician.length > 0) {
      let upsertErr = (
        await client.from('politician_committee_memberships').upsert(rowsWithPolitician, {
          onConflict: 'bioguide_id,committee_system_code,congress',
        })
      ).error;
      if (upsertErr?.message?.includes('committee_party')) {
        const rowsWithoutParty = rowsWithPolitician.map(
          ({ committee_party: _, ...rest }) => rest,
        );
        upsertErr = (
          await client.from('politician_committee_memberships').upsert(rowsWithoutParty, {
            onConflict: 'bioguide_id,committee_system_code,congress',
          })
        ).error;
      }
      if (upsertErr) {
        throw new Error(`Upsert memberships failed: ${upsertErr.message}`);
      }
    }

    const currentKeys = new Set(validRows.map((r) => membershipKey(r)));
    const { data: existingForCongress } = await client
      .from('politician_committee_memberships')
      .select('id, bioguide_id, committee_system_code')
      .eq('congress', congress);
    const toDeleteIds = (existingForCongress ?? [])
      .filter((e) => !currentKeys.has(membershipKey(e)))
      .map((e) => e.id);

    if (toDeleteIds.length > 0) {
      const { error: delErr } = await client
        .from('politician_committee_memberships')
        .delete()
        .in('id', toDeleteIds);
      if (delErr) {
        throw new Error(`Delete stale memberships failed: ${delErr.message}`);
      }
    }

    this.logger.log(
      `Committee membership sync: congress=${congress} upserted=${rowsWithPolitician.length} removed=${toDeleteIds.length}`,
    );

    return {
      congress,
      upserted: rowsWithPolitician.length,
      removed: toDeleteIds.length,
      warnings,
    };
  }
}
