import { defineConfig } from '@trigger.dev/sdk';
import { emitDecoratorMetadata } from '@trigger.dev/build/extensions/typescript';

export default defineConfig({
  project: 'proj_cvznhcslwvsomhwyqjjy',
  dirs: ['./trigger'],
  maxDuration: 7200,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [emitDecoratorMetadata()],
  },
});
