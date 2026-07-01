import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DataSyncJobKey, DataSyncJobSchedule } from './data-sync.types';
import { DATA_SYNC_JOB_KEYS } from './data-sync.types';
import { formatScheduleSummary } from './schedule-evaluator';
import {
  SYNC_JOB_CATALOG,
  SYNC_JOB_CATALOG_BY_KEY,
  SYNC_JOB_CATEGORY_LABELS,
  SYNC_JOB_CATEGORY_ORDER,
  type SyncJobCategory,
} from './sync-job-catalog';
import { loadDataSyncJobLastRuns } from '../sync/data-sync-run-store';
import type { DataSyncLastRun } from './data-sync.types';
import {
  loadDataSyncJobSchedule,
  loadDataSyncJobSchedules,
  updateDataSyncJobSchedule,
} from '../sync/data-sync-schedules.store';
import type { UpdateSyncScheduleDto } from './dto/update-sync-schedule.dto';
import { normalizeScheduleForFrequency } from './dto/update-sync-schedule.dto';

export interface DataSyncScheduleListItem {
  jobKey: DataSyncJobKey;
  displayName: string;
  category: SyncJobCategory;
  categoryLabel: string;
  description: string;
  formulaKey?: string;
  manualRunPath?: string;
  schedule: DataSyncJobSchedule | null;
  scheduleSummary: string | null;
  lastRun: DataSyncLastRun | null;
}

@Injectable()
export class DataSyncSchedulesService {
  async listSchedules(): Promise<DataSyncScheduleListItem[]> {
    const [schedules, lastRuns] = await Promise.all([
      loadDataSyncJobSchedules(),
      loadDataSyncJobLastRuns(),
    ]);

    return SYNC_JOB_CATALOG.map((entry) => {
      const schedule = schedules[entry.jobKey] ?? null;
      return {
        jobKey: entry.jobKey,
        displayName: entry.displayName,
        category: entry.category,
        categoryLabel: SYNC_JOB_CATEGORY_LABELS[entry.category],
        description: entry.description,
        formulaKey: entry.formulaKey,
        manualRunPath: entry.manualRunPath,
        schedule,
        scheduleSummary: schedule ? formatScheduleSummary(schedule) : null,
        lastRun: lastRuns[entry.jobKey] ?? null,
      };
    });
  }

  async getSchedule(jobKey: DataSyncJobKey): Promise<DataSyncScheduleListItem> {
    if (!SYNC_JOB_CATALOG_BY_KEY[jobKey]) {
      throw new NotFoundException(`Unknown sync job: ${jobKey}`);
    }
    const entry = SYNC_JOB_CATALOG_BY_KEY[jobKey];
    const [schedule, lastRuns] = await Promise.all([
      loadDataSyncJobSchedule(jobKey),
      loadDataSyncJobLastRuns(),
    ]);
    return {
      jobKey: entry.jobKey,
      displayName: entry.displayName,
      category: entry.category,
      categoryLabel: SYNC_JOB_CATEGORY_LABELS[entry.category],
      description: entry.description,
      formulaKey: entry.formulaKey,
      manualRunPath: entry.manualRunPath,
      schedule,
      scheduleSummary: schedule ? formatScheduleSummary(schedule) : null,
      lastRun: lastRuns[jobKey] ?? null,
    };
  }

  async patchSchedule(
    jobKey: DataSyncJobKey,
    dto: UpdateSyncScheduleDto,
    userId?: string,
  ): Promise<DataSyncScheduleListItem> {
    if (!DATA_SYNC_JOB_KEYS.includes(jobKey)) {
      throw new NotFoundException(`Unknown sync job: ${jobKey}`);
    }
    const existing = await loadDataSyncJobSchedule(jobKey);
    const normalized = normalizeScheduleForFrequency(dto, existing);
    const updated = await updateDataSyncJobSchedule(jobKey, {
      ...normalized,
      updated_by_user_id: userId ?? null,
    });
    if (!updated) {
      throw new BadRequestException('Failed to update schedule');
    }
    return this.getSchedule(jobKey);
  }

  formatScheduleSummary(schedule: DataSyncJobSchedule): string {
    return formatScheduleSummary(schedule);
  }

  getCategoryOrder(): SyncJobCategory[] {
    return SYNC_JOB_CATEGORY_ORDER;
  }
}
