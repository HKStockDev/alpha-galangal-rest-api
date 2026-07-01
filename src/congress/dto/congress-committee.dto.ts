export interface CongressCommitteeParentDto {
  url?: string;
  systemCode?: string;
  name?: string;
  [key: string]: unknown;
}

export interface CongressCommitteeSubcommitteeDto {
  url?: string;
  systemCode?: string;
  name?: string;
  [key: string]: unknown;
}

export interface CongressCommitteeListItemDto {
  url?: string;
  systemCode?: string;
  name?: string;
  chamber?: string;
  type?: string;
  committeeTypeCode?: string;
  parent?: CongressCommitteeParentDto;
  subcommittees?: CongressCommitteeSubcommitteeDto[];
  [key: string]: unknown;
}

export interface CongressCommitteeListResponseDto {
  committees?: CongressCommitteeListItemDto[];
  pagination?: { count?: number; next?: string; previous?: string };
  [key: string]: unknown;
}

export interface CongressCommitteeDetailDto {
  systemCode?: string;
  url?: string;
  updateDate?: string;
  active?: boolean | string;
  chamber?: string;
  type?: string;
  parent?: CongressCommitteeParentDto;
  subcommittees?: CongressCommitteeSubcommitteeDto[];
  [key: string]: unknown;
}

export interface CongressCommitteeDetailResponseDto {
  committee?: CongressCommitteeDetailDto;
  [key: string]: unknown;
}
