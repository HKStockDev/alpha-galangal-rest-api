import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type CacheEntry = { value: unknown; expiresAt: number };

@Injectable()
export class AssistantCacheService {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries = 1000;
  private readonly ttlMs: number;

  constructor(config: ConfigService) {
    this.ttlMs = Number(config.get<string>('ASSISTANT_TOOL_CACHE_TTL_MS') ?? 60_000);
  }

  private key(parts: {
    organizationId: string;
    clientId: string | null;
    toolKey: string;
    args: Record<string, unknown>;
  }): string {
    const canonical = JSON.stringify({
      c: parts.clientId,
      t: parts.toolKey,
      a: parts.args,
    });
    const digest = createHash('sha256').update(canonical).digest('hex');
    return `${parts.organizationId}:${digest}`;
  }

  get(params: {
    organizationId: string;
    clientId: string | null;
    toolKey: string;
    args: Record<string, unknown>;
  }): unknown | undefined {
    const k = this.key(params);
    const entry = this.store.get(k);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(k);
      return undefined;
    }
    return entry.value;
  }

  set(params: {
    organizationId: string;
    clientId: string | null;
    toolKey: string;
    args: Record<string, unknown>;
    value: unknown;
  }): void {
    if (this.store.size >= this.maxEntries) {
      const first = this.store.keys().next().value;
      if (first) this.store.delete(first);
    }
    const k = this.key(params);
    this.store.set(k, { value: params.value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidateOrganization(organizationId: string): void {
    const prefix = `${organizationId}:`;
    for (const k of [...this.store.keys()]) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
      }
    }
  }
}
