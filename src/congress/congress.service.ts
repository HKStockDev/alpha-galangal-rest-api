import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CongressCommitteeDetailResponseDto,
  CongressCommitteeListResponseDto,
  CongressMemberDetailResponseDto,
  CongressMemberListResponseDto,
} from './dto';

@Injectable()
export class CongressService {
  private readonly logger = new Logger(CongressService.name);

  constructor(private config: ConfigService) {}

  private getApiKey(): string | undefined {
    return this.config.get<string>('congressGov.apiKey') ?? process.env.CONGRESS_GOV_API_KEY;
  }

  private getBaseUrl(): string {
    const url = this.config.get<string>('congressGov.baseUrl') ?? process.env.CONGRESS_GOV_BASE_URL ?? 'https://api.congress.gov';
    return url.replace(/\/$/, '');
  }

  private async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('CONGRESS_GOV_API_KEY not configured');
      throw new Error('Congress.gov API key not configured');
    }
    const base = this.getBaseUrl();
    const versioned = base.includes('/v3') ? base : `${base}/v3`;
    const search = new URLSearchParams({ api_key: apiKey });
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') search.set(k, String(v));
      }
    }
    const url = `${versioned}${path}?${search.toString()}`;
    const res = await fetch(url);
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) {
      this.logger.warn(`Congress.gov API ${res.status}: ${(data as { error?: string }).error ?? res.statusText}`);
      throw new Error((data as { error?: string }).error ?? `Congress.gov API error ${res.status}`);
    }
    return data;
  }

  async getMembers(params?: { limit?: number; offset?: number; congress?: number }): Promise<CongressMemberListResponseDto> {
    return this.get<CongressMemberListResponseDto>('/member', params as Record<string, string | number | undefined>);
  }

  async getMemberByBioguideId(bioguideId: string): Promise<CongressMemberDetailResponseDto> {
    const id = encodeURIComponent(bioguideId);
    return this.get<CongressMemberDetailResponseDto>(`/member/${id}`);
  }

  async getMembersByState(
    stateCode: string,
    params?: { currentMember?: boolean },
  ): Promise<CongressMemberListResponseDto> {
    const state = encodeURIComponent(stateCode.trim().toUpperCase());
    const query: Record<string, string | number | undefined> = {};
    if (params?.currentMember != null) query.currentMember = String(params.currentMember);
    return this.get<CongressMemberListResponseDto>(`/member/${state}`, query);
  }

  async getMembersByStateAndDistrict(
    stateCode: string,
    district: number,
    params?: { currentMember?: boolean },
  ): Promise<CongressMemberListResponseDto> {
    const state = encodeURIComponent(stateCode.trim().toUpperCase());
    const dist = encodeURIComponent(String(district));
    const query: Record<string, string | number | undefined> = {};
    if (params?.currentMember != null) query.currentMember = String(params.currentMember);
    return this.get<CongressMemberListResponseDto>(`/member/${state}/${dist}`, query);
  }

  async getCommittees(params?: {
    limit?: number;
    offset?: number;
  }): Promise<CongressCommitteeListResponseDto> {
    return this.get<CongressCommitteeListResponseDto>('/committee', params as Record<string, string | number | undefined>);
  }

  async getCommitteesByCongress(
    congress: number,
    params?: { limit?: number; offset?: number; chamber?: string },
  ): Promise<CongressCommitteeListResponseDto> {
    const query: Record<string, string | number | undefined> = {};
    if (params?.limit != null) query.limit = params.limit;
    if (params?.offset != null) query.offset = params.offset;
    if (params?.chamber != null) query.chamber = params.chamber;
    return this.get<CongressCommitteeListResponseDto>(`/committee/${congress}`, Object.keys(query).length ? query : undefined);
  }

  async getCommitteeBySystemCode(
    congress: number,
    systemCode: string,
  ): Promise<CongressCommitteeDetailResponseDto> {
    const congressPath = encodeURIComponent(congress);
    const code = encodeURIComponent(systemCode);
    return this.get<CongressCommitteeDetailResponseDto>(`/committee/${congressPath}/${code}`);
  }
}
