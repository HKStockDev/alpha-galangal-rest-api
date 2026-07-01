import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FmpService } from '../fmp/fmp.service';

export interface TickerDetailsForEnrichment {
  ticker: string;
  name: string;
  description?: string;
  sic_code?: string;
  sic_description?: string;
  homepage_url?: string;
  primary_exchange?: string;
}

const DEFAULT_TAXONOMY_ID = 'da747382-8b83-4b0c-ad7c-234542e622c4';

/** PostgREST typically caps one select (~1000 rows); page for full universe. */
const SECURITIES_PAGE_SIZE = 1000;

interface ActivePromptVersion {
  system_prompt: string | null;
  user_prompt_template: string | null;
  model_name: string | null;
  temperature: number | null;
  max_output_tokens: number | null;
}

@Injectable()
export class SecurityEnrichmentService {
  private readonly logger = new Logger(SecurityEnrichmentService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(
    private config: ConfigService,
    private fmpService: FmpService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const key = this.config.get<string>('supabase.serviceRoleKey') ?? this.config.get<string>('supabase.anonKey');
    if (url && key) this.adminClient = createClient(url, key);
  }

  private getGeminiApiKey(): string | undefined {
    return this.config.get<string>('gemini.apiKey') ?? process.env.GEMINI_API_KEY;
  }

  private getTaxonomyId(): string {
    return this.config.get<string>('taxonomy.gicsTaxonomyId') ?? DEFAULT_TAXONOMY_ID;
  }

  async getOrCreateEntityForSecurity(
    securityId: string,
    ticker: string,
    name: string,
  ): Promise<string | null> {
    if (!this.adminClient) return null;
    const { data: sec } = await this.adminClient
      .from('securities')
      .select('entity_id')
      .eq('id', securityId)
      .single();
    if (sec?.entity_id) return sec.entity_id;
    const { data: byKey } = await this.adminClient
      .from('entities')
      .select('id')
      .eq('entity_type', 'security')
      .eq('key', ticker)
      .maybeSingle();
    if (byKey?.id) {
      await this.adminClient.from('securities').update({ entity_id: byKey.id }).eq('id', securityId);
      return byKey.id;
    }
    const { data: inserted, error } = await this.adminClient
      .from('entities')
      .insert({ entity_type: 'security', key: ticker, name: name || ticker })
      .select('id')
      .single();
    if (error || !inserted?.id) return null;
    await this.adminClient.from('securities').update({ entity_id: inserted.id }).eq('id', securityId);
    return inserted.id;
  }

  private async loadActivePromptVersion(promptKey: string): Promise<ActivePromptVersion | null> {
    if (!this.adminClient) return null;
    const { data: prompt, error: pErr } = await this.adminClient
      .from('prompts')
      .select('active_prompt_version_id')
      .eq('key', promptKey)
      .single();
    if (pErr || !prompt?.active_prompt_version_id) return null;
    const { data: pv, error: pvErr } = await this.adminClient
      .from('prompt_versions')
      .select('system_prompt, user_prompt_template, model_name, temperature, max_output_tokens')
      .eq('id', prompt.active_prompt_version_id)
      .single();
    if (pvErr || !pv) return null;
    return pv as ActivePromptVersion;
  }

  private fillTemplate(template: string, vars: Record<string, string>): string {
    let out = template;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v ?? '');
    }
    return out;
  }

  private async runGemini(
    promptVersion: ActivePromptVersion,
    templateVars: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    const userText = this.fillTemplate(promptVersion.user_prompt_template ?? '', templateVars);
    const systemText = promptVersion.system_prompt ?? '';
    const model = (promptVersion.model_name ?? 'gemini-2.0-flash').startsWith('models/')
      ? promptVersion.model_name
      : `models/${promptVersion.model_name ?? 'gemini-2.0-flash'}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: promptVersion.temperature ?? 0.2,
        maxOutputTokens: promptVersion.max_output_tokens ?? 2048,
        responseMimeType: 'application/json',
      },
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error((data?.error as { message?: string })?.message ?? res.statusText);
    const parts = (data?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>)?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p?.text ?? '').join('').trim();
    if (!text) throw new Error('Empty Gemini response');
    let raw = text;
    const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
    if (codeBlock) raw = codeBlock[1].trim();
    return JSON.parse(raw) as Record<string, unknown>;
  }

  async classifyTaxonomy(
    securityId: string,
    tickerDetails: TickerDetailsForEnrichment,
  ): Promise<{ taxonomy_node_id: string } | null> {
    if (!this.adminClient) return null;
    const taxonomyId = this.getTaxonomyId();
    const promptVersion = await this.loadActivePromptVersion('security_classification');
    if (!promptVersion) {
      this.logger.warn('security_classification prompt not found');
      return null;
    }
    const { data: nodes } = await this.adminClient
      .from('taxonomy_nodes')
      .select('node_id, code, title')
      .eq('taxonomy_id', taxonomyId)
      .eq('level', 'sub_industry')
      .order('code');
    const titleCol = nodes?.[0] && 'title' in nodes[0] ? 'title' : 'name';
    const subIndustriesList = (nodes ?? [])
      .map((n) => `${(n as { code: string }).code}: ${(n as Record<string, string>)[titleCol] ?? ''}`)
      .join('\n');
    const codeToNode = Object.fromEntries(
      (nodes ?? []).map((n) => [String((n as { code: string }).code).trim(), n as { node_id: string }]),
    );
    const result = await this.runGemini(promptVersion, {
      ticker: tickerDetails.ticker ?? '',
      name: tickerDetails.name ?? '',
      sic_code: tickerDetails.sic_code ?? 'N/A',
      sic_description: tickerDetails.sic_description ?? 'N/A',
      description: (tickerDetails.description ?? '').slice(0, 1500),
      homepage_url: tickerDetails.homepage_url ?? 'N/A',
      primary_exchange: tickerDetails.primary_exchange ?? 'N/A',
      sub_industries_list: subIndustriesList,
    });
    const gicsCode = String(result.gics_code ?? '').trim();
    const node = codeToNode[gicsCode];
    if (!node) {
      this.logger.warn(`GICS code not found: ${gicsCode}`);
      return null;
    }
    let confidence = Number(result.confidence);
    if (Number.isNaN(confidence) || confidence < 0) confidence = 0.5;
    if (confidence > 1) confidence = 1;
    const asOfDate = new Date().toISOString().slice(0, 10);
    const notes = `${tickerDetails.ticker} -> GICS ${gicsCode}. ${(result.reasoning as string) ?? ''}`.slice(0, 500);
    await this.adminClient
      .from('security_classifications')
      .upsert(
        {
          security_id: securityId,
          taxonomy_id: taxonomyId,
          taxonomy_node_id: node.node_id,
          source: 'llm_assisted',
          confidence: Math.round(confidence * 10000) / 10000,
          as_of_date: asOfDate,
          notes,
        },
        { onConflict: 'security_id,taxonomy_id,taxonomy_node_id,as_of_date' },
      );
    return { taxonomy_node_id: node.node_id };
  }

  async assignTags(
    securityId: string,
    tickerDetails: TickerDetailsForEnrichment,
  ): Promise<{ count: number }> {
    if (!this.adminClient) return { count: 0 };
    const promptVersion = await this.loadActivePromptVersion('security_tagging');
    if (!promptVersion) {
      this.logger.warn('security_tagging prompt not found');
      return { count: 0 };
    }
    const { data: tags } = await this.adminClient
      .from('tags')
      .select('tag_id, slug, name, group')
      .eq('is_active', true)
      .eq('is_llm_assignable', true);
    const tagsList = (tags ?? []).map((t) => ({ slug: t.slug, name: t.name, group: t.group }));
    const slugToId = Object.fromEntries((tags ?? []).map((t) => [t.slug, t.tag_id]));
    const result = await this.runGemini(promptVersion, {
      ticker: tickerDetails.ticker ?? '',
      name: tickerDetails.name ?? '',
      description: (tickerDetails.description ?? '').slice(0, 2000),
      tags_json: JSON.stringify(tagsList, null, 2),
    });
    const assignments = (result.assignments as Array<{ tag_slug: string; confidence?: number; evidence?: string }>) ?? [];
    const asOfDate = new Date().toISOString().slice(0, 10);
    let inserted = 0;
    for (const a of assignments) {
      const tagId = slugToId[a.tag_slug];
      if (!tagId) continue;
      const confidence = Math.min(1, Math.max(0, Number(a.confidence) || 0.5));
      const { error } = await this.adminClient.from('security_tags').upsert(
        {
          security_id: securityId,
          tag_id: tagId,
          source: 'llm',
          confidence,
          evidence: (a.evidence as string)?.slice(0, 1000) ?? null,
          as_of_date: asOfDate,
        },
        { onConflict: 'security_id,tag_id,as_of_date' },
      );
      if (!error) inserted++;
    }
    return { count: inserted };
  }

  async assignExposures(
    securityId: string,
    tickerDetails: TickerDetailsForEnrichment,
  ): Promise<{ count: number }> {
    if (!this.adminClient) return { count: 0 };
    const promptVersion = await this.loadActivePromptVersion('security_exposures');
    if (!promptVersion) {
      this.logger.warn('security_exposures prompt not found');
      return { count: 0 };
    }
    const { data: exposures } = await this.adminClient
      .from('exposures')
      .select('exposure_id, slug, name, category, polarity')
      .eq('is_active', true);
    const exposuresList = (exposures ?? []).map((e) => ({
      slug: e.slug,
      name: e.name,
      category: e.category,
      polarity: e.polarity,
    }));
    const slugToId = Object.fromEntries((exposures ?? []).map((e) => [e.slug, e.exposure_id]));
    const result = await this.runGemini(promptVersion, {
      ticker: tickerDetails.ticker ?? '',
      name: tickerDetails.name ?? '',
      description: (tickerDetails.description ?? '').slice(0, 2000),
      exposures_json: JSON.stringify(exposuresList, null, 2),
    });
    const assignments = (result.assignments as Array<{
      exposure_slug: string;
      direction: string;
      strength?: number;
      confidence?: number;
      evidence?: string;
    }>) ?? [];
    const validDirections = ['beneficiary', 'dependent', 'supplier', 'customer'];
    const asOfDate = new Date().toISOString().slice(0, 10);
    let inserted = 0;
    for (const a of assignments) {
      const exposureId = slugToId[a.exposure_slug];
      if (!exposureId) continue;
      const direction = validDirections.includes(a.direction) ? a.direction : 'beneficiary';
      const strength = Math.min(1, Math.max(0, Number(a.strength) ?? 0.5));
      const { error } = await this.adminClient.from('security_exposures').upsert(
        {
          security_id: securityId,
          exposure_id: exposureId,
          direction,
          strength,
          source: 'llm',
          confidence: Math.min(1, Math.max(0, Number(a.confidence) ?? 0.5)),
          evidence: (a.evidence as string)?.slice(0, 1000) ?? null,
          as_of_date: asOfDate,
        },
        { onConflict: 'security_id,exposure_id,direction,as_of_date' },
      );
      if (!error) inserted++;
    }
    return { count: inserted };
  }

  async enrichTickers(tickers: string[]): Promise<{
    results: Array<{
      ticker: string;
      security_id: string | null;
      entity_id: string | null;
      classification: boolean;
      tags_count: number;
      exposures_count: number;
      error?: string;
    }>;
  }> {
    const results: Array<{
      ticker: string;
      security_id: string | null;
      entity_id: string | null;
      classification: boolean;
      tags_count: number;
      exposures_count: number;
      error?: string;
    }> = [];
    for (const ticker of tickers) {
      const normalized = String(ticker ?? '').trim().toUpperCase();
      if (!normalized) continue;
      try {
        const syncResult = await this.fmpService.syncTickerToSecurities(normalized);
        if (!syncResult.ok) {
          results.push({
            ticker: normalized,
            security_id: null,
            entity_id: null,
            classification: false,
            tags_count: 0,
            exposures_count: 0,
            error:
              syncResult.code === 'filtered'
                ? syncResult.message
                : 'Ticker not found or sync failed',
          });
          continue;
        }
        const securityId = syncResult.security_id;
        const profile = await this.fmpService.fetchProfileFromApi(normalized);
        if (!profile) {
          results.push({
            ticker: normalized,
            security_id: securityId,
            entity_id: null,
            classification: false,
            tags_count: 0,
            exposures_count: 0,
            error: 'Could not fetch profile',
          });
          continue;
        }
        const details: TickerDetailsForEnrichment = {
          ticker: profile.symbol ?? normalized,
          name: profile.companyName ?? normalized,
          description: profile.description ?? '',
          sic_code: profile.cik ?? '',
          sic_description: '',
          homepage_url: profile.website ?? '',
          primary_exchange: profile.exchangeShortName ?? profile.exchange ?? '',
        };
        const entityId = await this.getOrCreateEntityForSecurity(
          securityId,
          normalized,
          details.name ?? normalized,
        );
        await this.classifyTaxonomy(securityId, details);
        const tagsResult = await this.assignTags(securityId, details);
        const exposuresResult = await this.assignExposures(securityId, details);
        results.push({
          ticker: normalized,
          security_id: securityId,
          entity_id: entityId,
          classification: true,
          tags_count: tagsResult.count,
          exposures_count: exposuresResult.count,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Enrichment failed for ${normalized}: ${msg}`);
        results.push({
          ticker: normalized,
          security_id: null,
          entity_id: null,
          classification: false,
          tags_count: 0,
          exposures_count: 0,
          error: msg,
        });
      }
    }
    return { results };
  }

  /**
   * Recomputes LLM security_exposures for all active stock-market securities (weekly job).
   * Uses FMP profile text + Gemini; does not re-run taxonomy or tags.
   */
  async syncExposuresForAllEquitySecurities(options?: {
    delayMs?: number;
    limit?: number | null;
  }): Promise<{
    total: number;
    processed: number;
    skippedNoProfile: number;
    exposuresAssignedTotal: number;
    errors: string[];
  }> {
    const delayMs = Math.max(0, options?.delayMs ?? 400);
    const limit =
      options?.limit != null && Number.isFinite(options.limit)
        ? Math.max(0, Math.floor(Number(options.limit)))
        : null;

    if (!this.adminClient) {
      return {
        total: 0,
        processed: 0,
        skippedNoProfile: 0,
        exposuresAssignedTotal: 0,
        errors: ['Supabase client not configured'],
      };
    }

    const list: Array<{ id: string; ticker: string }> = [];
    let from = 0;
    while (true) {
      const { data: page, error } = await this.adminClient
        .from('securities')
        .select('id, ticker')
        .eq('market', 'stocks')
        .eq('active', true)
        .order('ticker')
        .range(from, from + SECURITIES_PAGE_SIZE - 1);
      if (error) {
        return {
          total: 0,
          processed: 0,
          skippedNoProfile: 0,
          exposuresAssignedTotal: 0,
          errors: [error.message],
        };
      }
      const rows = page ?? [];
      for (const r of rows) {
        list.push(r as { id: string; ticker: string });
        if (limit != null && limit > 0 && list.length >= limit) break;
      }
      if (limit != null && limit > 0 && list.length >= limit) break;
      if (rows.length < SECURITIES_PAGE_SIZE) break;
      from += SECURITIES_PAGE_SIZE;
    }
    const total = list.length;
    let processed = 0;
    let skippedNoProfile = 0;
    let exposuresAssignedTotal = 0;
    const errors: string[] = [];

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (let i = 0; i < list.length; i++) {
      if (i > 0 && delayMs > 0) await sleep(delayMs);
      const row = list[i];
      const securityId = row.id as string;
      const normalized = String(row.ticker ?? '').trim().toUpperCase();
      if (!normalized) continue;
      try {
        const profile = await this.fmpService.fetchProfileFromApi(normalized);
        if (!profile) {
          skippedNoProfile++;
          continue;
        }
        const details: TickerDetailsForEnrichment = {
          ticker: profile.symbol ?? normalized,
          name: profile.companyName ?? normalized,
          description: profile.description ?? '',
          sic_code: profile.cik ?? '',
          sic_description: '',
          homepage_url: profile.website ?? '',
          primary_exchange: profile.exchangeShortName ?? profile.exchange ?? '',
        };
        const { count } = await this.assignExposures(securityId, details);
        exposuresAssignedTotal += count;
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${normalized}: ${msg}`);
        this.logger.warn(`Exposure sync failed for ${normalized}: ${msg}`);
      }
    }

    return {
      total,
      processed,
      skippedNoProfile,
      exposuresAssignedTotal,
      errors,
    };
  }
}
