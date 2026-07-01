export interface CommitteeMembershipMemberDto {
  name: string;
  party: string;
  rank: number;
  title?: string;
  bioguide: string;
  chamber?: 'senate' | 'house';
}

export type CommitteeMembershipYamlDto = Record<string, CommitteeMembershipMemberDto[]>;

export type CommitteeRoleDto = 'chair' | 'ranking_member' | 'vice_chair' | 'member' | 'ex_officio' | 'other';

export interface NormalizedCommitteeMembershipDto {
  committee_system_code: string;
  bioguide_id: string;
  role: CommitteeRoleDto;
  member_rank: number;
  committee_party?: string;
  congress?: number;
}
