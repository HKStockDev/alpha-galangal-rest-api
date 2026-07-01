import { Injectable } from '@nestjs/common';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export type TestLogPayload = Record<string, unknown>;

@Injectable()
export class TestLogService {
  private readonly logPath = join(process.cwd(), 'test_log.log');
  private writeChain: Promise<void> = Promise.resolve();

  log(source: string, event: string, data?: TestLogPayload): void {
    const entry = {
      timestamp: new Date().toISOString(),
      source,
      event,
      ...(data !== undefined ? { data } : {}),
    };

    const line = `${JSON.stringify(entry)}\n`;
    this.writeChain = this.writeChain
      .then(() => appendFile(this.logPath, line, 'utf8'))
      .catch(() => undefined);
  }
}
