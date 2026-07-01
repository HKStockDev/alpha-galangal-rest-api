import { Global, Module } from '@nestjs/common';
import { TestLogService } from './test-log.service';

@Global()
@Module({
  providers: [TestLogService],
  exports: [TestLogService],
})
export class TestLogModule {}
