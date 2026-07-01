import type { TriggerSyncTaskId } from './trigger-task-ids';

export interface TriggerDispatchResult {
  mode: 'trigger';
  taskId: TriggerSyncTaskId;
  runId: string;
  message: string;
}

export function isTriggerDispatchResult(
  value: unknown,
): value is TriggerDispatchResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as TriggerDispatchResult).mode === 'trigger' &&
    typeof (value as TriggerDispatchResult).runId === 'string'
  );
}
