import { Injectable, Logger } from '@nestjs/common';
import { tasks } from '@trigger.dev/sdk';
import type { TriggerSyncTaskId } from './trigger-task-ids';
import type { TriggerDispatchResult } from './trigger-sync.types';

@Injectable()
export class TriggerSyncService {
  private readonly logger = new Logger(TriggerSyncService.name);

  /** When true, manual sync endpoints dispatch to Trigger.dev instead of running inline. */
  useTriggerDispatch(): boolean {
    if ((process.env.SYNC_RUN_INLINE ?? '').trim().toLowerCase() === 'true') {
      return false;
    }
    return Boolean((process.env.TRIGGER_SECRET_KEY ?? '').trim());
  }

  isTriggerConfigured(): boolean {
    return Boolean((process.env.TRIGGER_SECRET_KEY ?? '').trim());
  }

  async dispatch<TPayload extends Record<string, unknown>>(
    taskId: TriggerSyncTaskId,
    payload: TPayload,
  ): Promise<TriggerDispatchResult> {
    const handle = await tasks.trigger(taskId, payload);
    this.logger.log(`Dispatched Trigger task ${taskId} runId=${handle.id}`);
    return {
      mode: 'trigger',
      taskId,
      runId: handle.id,
      message: `Sync started on Trigger.dev (run ${handle.id}). Track progress in the Trigger dashboard.`,
    };
  }
}
