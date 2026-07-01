import { Injectable, Logger } from '@nestjs/common';
import { evaluateAndDispatchDueJobs } from './data-sync-dispatcher';

@Injectable()
export class DataSyncDispatcherService {
  private readonly logger = new Logger(DataSyncDispatcherService.name);

  evaluateAndDispatchDueJobs() {
    return evaluateAndDispatchDueJobs().then((result) => {
      if (result.dispatched.length > 0) {
        this.logger.log(`Dispatched sync jobs: ${result.dispatched.join(', ')}`);
      }
      return result;
    });
  }
}
