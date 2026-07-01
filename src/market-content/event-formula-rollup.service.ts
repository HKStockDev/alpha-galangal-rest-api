import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type EventRollupWindows = '30d' | '90d' | 'both';

interface EventMetric {
  positive: number;
  negative: number;
  pressure: number;
}

@Injectable()
export class EventFormulaRollupService {
  private readonly logger = new Logger(EventFormulaRollupService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private toMonths(w: EventRollupWindows): Array<{ periodKey: '1m' | '3m'; months: number }> {
    if (w === '30d') return [{ periodKey: '1m', months: 1 }];
    if (w === '90d') return [{ periodKey: '3m', months: 3 }];
    return [
      { periodKey: '1m', months: 1 },
      { periodKey: '3m', months: 3 },
    ];
  }

  async recompute(windows: EventRollupWindows): Promise<{ entities: number; upserts: number }> {
    if (!this.adminClient) return { entities: 0, upserts: 0 };
    const client = this.adminClient;

    const { data: factors } = await client
      .from('factors')
      .select('id, key')
      .in('key', ['positive_event_count', 'negative_event_count', 'event_pressure', 'event_pressure_trend']);
    const factorIdByKey = new Map((factors ?? []).map((f) => [f.key as string, f.id as string]));
    if (factorIdByKey.size === 0) return { entities: 0, upserts: 0 };

    const { data: allEntities } = await client.from('market_content_entities').select('entity_id');
    const entityIds = [...new Set((allEntities ?? []).map((r) => r.entity_id as string).filter(Boolean))];
    if (entityIds.length === 0) return { entities: 0, upserts: 0 };

    const periods = this.toMonths(windows);
    const maxMonths = Math.max(...periods.map((p) => p.months));
    const minPublishedAt = new Date();
    minPublishedAt.setMonth(minPublishedAt.getMonth() - maxMonths);

    const { data: events } = await client
      .from('market_content_entities')
      .select('entity_id, should_display, polarity, severity, materiality_score, market_content:market_content_id(published_at)')
      .in('entity_id', entityIds);

    const cutoffByPeriod = new Map<string, number>();
    for (const p of periods) {
      const d = new Date();
      d.setMonth(d.getMonth() - p.months);
      cutoffByPeriod.set(p.periodKey, d.getTime());
    }
    const metricByEntityPeriod = new Map<string, EventMetric>();
    const eventRows = (events ?? []) as Array<{
      entity_id: string;
      should_display: boolean | null;
      polarity: number | null;
      severity: number | null;
      materiality_score: number | null;
      market_content: { published_at?: string | null } | Array<{ published_at?: string | null }> | null;
    }>;

    for (const ev of eventRows) {
      if (!ev.entity_id || ev.should_display !== true) continue;
      const mc = Array.isArray(ev.market_content) ? ev.market_content[0] : ev.market_content;
      const publishedAt = mc?.published_at ? Date.parse(String(mc.published_at)) : NaN;
      if (!Number.isFinite(publishedAt) || publishedAt < minPublishedAt.getTime()) continue;
      const polarity = Number(ev.polarity ?? 0);
      const severity = Number(ev.severity ?? 1);
      const materiality = Number(ev.materiality_score ?? 1);
      const pressure = polarity * severity * materiality;
      for (const p of periods) {
        if (publishedAt < (cutoffByPeriod.get(p.periodKey) ?? 0)) continue;
        const k = `${ev.entity_id}:${p.periodKey}`;
        const cur = metricByEntityPeriod.get(k) ?? { positive: 0, negative: 0, pressure: 0 };
        if (polarity === 1) cur.positive += 1;
        if (polarity === -1) cur.negative += 1;
        cur.pressure += pressure;
        metricByEntityPeriod.set(k, cur);
      }
    }

    let upserts = 0;
    const nowIso = new Date().toISOString();
    const asOfDate = nowIso.slice(0, 10);

    for (const entityId of entityIds) {
      for (const p of periods) {
        const m = metricByEntityPeriod.get(`${entityId}:${p.periodKey}`) ?? {
          positive: 0,
          negative: 0,
          pressure: 0,
        };
        const rows = [
          {
            factorKey: 'positive_event_count',
            valueNum: m.positive,
          },
          {
            factorKey: 'negative_event_count',
            valueNum: m.negative,
          },
          {
            factorKey: 'event_pressure',
            valueNum: m.pressure,
          },
        ] as const;
        for (const row of rows) {
          const factorId = factorIdByKey.get(row.factorKey);
          if (!factorId) continue;
          await client.from('entity_factor_values').upsert(
            {
              entity_id: entityId,
              factor_id: factorId,
              model_version: 'v1',
              period_key: p.periodKey,
              period_months: p.months,
              value_num: row.valueNum,
              source: 'event_formula_rollup',
              ingested_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: 'entity_id,factor_id,model_version,period_key' },
          );
          await client.from('entity_factor_values_ts').upsert(
            {
              entity_id: entityId,
              factor_id: factorId,
              value_num: row.valueNum,
              period_key: p.periodKey,
              period_months: p.months,
              start_date: p.periodKey === '1m' ? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10) : new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10),
              end_date: asOfDate,
              period_of_report_date: asOfDate,
              model_version: 'v1',
              as_of_date: asOfDate,
              source: 'event_formula_rollup',
              ingested_at: nowIso,
            },
            { onConflict: 'entity_id,factor_id,model_version,period_key,as_of_date' },
          );
          upserts += 2;
        }
      }

      if (periods.some((p) => p.periodKey === '1m') && periods.some((p) => p.periodKey === '3m')) {
        const p1 = metricByEntityPeriod.get(`${entityId}:1m`) ?? { positive: 0, negative: 0, pressure: 0 };
        const p3 = metricByEntityPeriod.get(`${entityId}:3m`) ?? { positive: 0, negative: 0, pressure: 0 };
        const trend = p1.pressure - p3.pressure;
        const trendFactorId = factorIdByKey.get('event_pressure_trend');
        if (trendFactorId) {
          await client.from('entity_factor_values').upsert(
            {
              entity_id: entityId,
              factor_id: trendFactorId,
              model_version: 'v1',
              period_key: 'na',
              period_months: null,
              value_num: trend,
              source: 'event_formula_rollup',
              ingested_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: 'entity_id,factor_id,model_version,period_key' },
          );
          await client.from('entity_factor_values_ts').upsert(
            {
              entity_id: entityId,
              factor_id: trendFactorId,
              value_num: trend,
              period_key: 'na',
              period_months: null,
              start_date: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10),
              end_date: asOfDate,
              period_of_report_date: asOfDate,
              model_version: 'v1',
              as_of_date: asOfDate,
              source: 'event_formula_rollup',
              ingested_at: nowIso,
            },
            { onConflict: 'entity_id,factor_id,model_version,period_key,as_of_date' },
          );
          upserts += 2;
        }
      }
    }

    this.logger.log(`CON-51 rollup recompute completed: entities=${entityIds.length}, upserts=${upserts}`);
    return { entities: entityIds.length, upserts };
  }
}
