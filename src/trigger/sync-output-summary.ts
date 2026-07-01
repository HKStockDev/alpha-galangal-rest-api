import { TRIGGER_SYNC_TASK_IDS, type TriggerSyncTaskId } from './trigger-task-ids';

function errorCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function formulaSyncSummary(o: Record<string, unknown>): string {
  const snap = o.snapshot as Record<string, unknown> | undefined;
  const snapPart =
    snap && snap.skipped === false
      ? `snapshot=${snap.slug} rows=${snap.rowCount ?? 0}`
      : `snapshot=skipped(${snap?.reason ?? 'unknown'})`;
  return `formula=${o.formulaKey} scores=${o.scoresWritten ?? 0} errors=${errorCount(o.errors)}; ${snapPart}`;
}

/** Human-readable one-line summary for sync task output (matches Nest scheduler wording). */
export function formatSyncOutputSummary(
  taskId: TriggerSyncTaskId,
  output: unknown,
): string | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const o = output as Record<string, unknown>;

  switch (taskId) {
    case TRIGGER_SYNC_TASK_IDS.fmpPoliticalTrades:
      return `inserted=${o.inserted}; errors=${errorCount(o.errors)}`;
    case TRIGGER_SYNC_TASK_IDS.fmpPoliticalFeedMissingSecurities:
      return `missing=${o.missingInSecurities} synced=${o.synced} filtered=${o.filtered} notFound=${o.notFound} failed=${o.failed}`;
    case TRIGGER_SYNC_TASK_IDS.congressMembers:
      return `congress=${o.congress} synced=${o.synced} errors=${o.errors}`;
    case TRIGGER_SYNC_TASK_IDS.committeeMemberships:
      return `upserted=${o.upserted} removed=${o.removed}; warnings=${errorCount(o.warnings)}`;
    case TRIGGER_SYNC_TASK_IDS.taxonomyStructuralGrowthCagrScores:
      return `scanned=${o.entitiesScanned} horizonUpserts=${o.horizonScoresUpserted} composites=${o.compositesUpserted} withAll=${o.entitiesWithAllHorizons} missingAny=${o.entitiesMissingAnyHorizon} errors=${errorCount(o.errors)}`;
    case TRIGGER_SYNC_TASK_IDS.taxonomyCycleScores:
      return `total=${o.entitiesTotal} processed=${o.entitiesProcessed} skippedNoPrompt=${o.skippedNoPrompt} llmCalls=${o.llmCalls} horizonUpserts=${o.horizonUpserts} errors=${errorCount(o.errors)}`;
    case TRIGGER_SYNC_TASK_IDS.equityExposures:
      return `total=${o.total} processed=${o.processed} skippedNoProfile=${o.skippedNoProfile} exposuresRows=${o.exposuresAssignedTotal} errors=${errorCount(o.errors)}`;
    case TRIGGER_SYNC_TASK_IDS.jobsFactorsSync:
      return `processed=${o.processed ?? o.entitiesProcessed ?? 0} upserted=${o.upserted ?? o.factorsUpserted ?? 0} errors=${errorCount(o.errors)}`;
    case TRIGGER_SYNC_TASK_IDS.politicalScore:
    case TRIGGER_SYNC_TASK_IDS.insiderConvictionScore:
    case TRIGGER_SYNC_TASK_IDS.netExposureScore:
    case TRIGGER_SYNC_TASK_IDS.hedgeFundQualityScore:
    case TRIGGER_SYNC_TASK_IDS.fundamentalConstrictionScore:
    case TRIGGER_SYNC_TASK_IDS.buffettCommitteeScore:
    case TRIGGER_SYNC_TASK_IDS.burryCommitteeScore:
    case TRIGGER_SYNC_TASK_IDS.americaFirstScore:
      return formulaSyncSummary(o);
    default:
      return undefined;
  }
}
