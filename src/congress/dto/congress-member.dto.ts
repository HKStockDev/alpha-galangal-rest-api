export interface CongressMemberListItemDto {
  bioguideId?: string;
  name?: string;
  [key: string]: unknown;
}

export interface CongressMemberListResponseDto {
  members?: CongressMemberListItemDto[];
  pagination?: { count?: number; next?: string; previous?: string };
  [key: string]: unknown;
}

export interface CongressServiceTermDto {
  congress?: number;
  chamber?: string;
  startYear?: number;
  endYear?: number;
  stateCode?: string;
  state?: string;
  district?: number | string;
  party?: string;
  partyCode?: string;
  type?: string;
  [key: string]: unknown;
}

export interface CongressMemberDetailDto {
  bioguideId?: string;
  name?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  nickname?: string;
  directorialTerms?: CongressServiceTermDto[];
  serviceTerms?: CongressServiceTermDto[];
  birthYear?: number;
  deathYear?: number;
  officialWebsiteUrl?: string;
  honorificName?: string;
  portrait?: string;
  contact?: { address?: string[]; phone?: string } | string[];
  [key: string]: unknown;
}

export interface CongressMemberDetailResponseDto {
  member?: CongressMemberDetailDto;
  [key: string]: unknown;
}
