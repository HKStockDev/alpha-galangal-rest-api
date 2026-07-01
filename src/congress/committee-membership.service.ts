import { Injectable, Logger } from '@nestjs/common';
import { load as yamlLoad } from 'js-yaml';
import type {
  CommitteeMembershipMemberDto,
  CommitteeMembershipYamlDto,
  CommitteeRoleDto,
  NormalizedCommitteeMembershipDto,
} from './dto';
import { getCurrentCongressNumber } from './congress-session.util';

const COMMITTEE_MEMBERSHIP_CURRENT_URL =
  'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml';

@Injectable()
export class CommitteeMembershipService {
  private readonly logger = new Logger(CommitteeMembershipService.name);

  private mapTitleToRole(title: string | undefined): CommitteeRoleDto {
    if (!title || typeof title !== 'string') return 'member';
    const t = title.toLowerCase();
    if (t.includes('chair') && !t.includes('ranking') && !t.includes('vice')) return 'chair';
    if (t.includes('ranking member')) return 'ranking_member';
    if (t.includes('vice chair') || t.includes('vice chairman')) return 'vice_chair';
    if (t.includes('ex officio')) return 'ex_officio';
    return 'member';
  }

  async fetchCommitteeMembershipCurrent(): Promise<CommitteeMembershipYamlDto> {
    const res = await fetch(COMMITTEE_MEMBERSHIP_CURRENT_URL);
    if (!res.ok) {
      this.logger.warn(`Committee membership YAML fetch failed: ${res.status}`);
      throw new Error(`Failed to fetch committee membership: ${res.status}`);
    }
    const text = await res.text();
    const parsed = yamlLoad(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid committee membership YAML');
    }
    const out: CommitteeMembershipYamlDto = {};
    for (const [code, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) {
        continue;
      }
      out[code] = list
        .filter((m): m is Record<string, unknown> => m != null && typeof m === 'object')
        .map((m) => ({
          name: typeof m.name === 'string' ? m.name : '',
          party: typeof m.party === 'string' ? m.party : '',
          rank: typeof m.rank === 'number' ? m.rank : 0,
          title: typeof m.title === 'string' ? m.title : undefined,
          bioguide: typeof m.bioguide === 'string' ? m.bioguide : '',
          chamber:
            m.chamber === 'senate' || m.chamber === 'house' ? (m.chamber as 'senate' | 'house') : undefined,
        })) as CommitteeMembershipMemberDto[];
    }
    return out;
  }

  normalizeToMembershipRows(
    yamlData: CommitteeMembershipYamlDto,
    congress: number,
  ): NormalizedCommitteeMembershipDto[] {
    const rows: NormalizedCommitteeMembershipDto[] = [];
    for (const [code, members] of Object.entries(yamlData)) {
      const systemCode = code.toLowerCase();
      for (const m of members) {
        if (!m.bioguide) continue;
        rows.push({
          committee_system_code: systemCode,
          bioguide_id: m.bioguide,
          role: this.mapTitleToRole(m.title),
          member_rank: m.rank,
          committee_party: m.party && (m.party === 'majority' || m.party === 'minority') ? m.party : undefined,
          congress,
        });
      }
    }
    return rows;
  }

  async getCommitteeMembershipCurrentParsed(): Promise<{
    byCommittee: CommitteeMembershipYamlDto;
    normalizedPreview: NormalizedCommitteeMembershipDto[];
  }> {
    const byCommittee = await this.fetchCommitteeMembershipCurrent();
    const currentCongress = getCurrentCongressNumber();
    const normalizedPreview = this.normalizeToMembershipRows(byCommittee, currentCongress);
    return { byCommittee, normalizedPreview };
  }
}
