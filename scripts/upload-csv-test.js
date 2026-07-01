/**
 * Simulates front-end CSV upload: runs the same HedgeFundsService.uploadCsv() path.
 * Usage: npm run build && node scripts/upload-csv-test.js [path-to.csv]
 * Default CSV path: ./form_13f_performance-smallv2.csv (or pass full path)
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.development') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const csvPath = process.argv[2] || path.join(__dirname, '..', 'form_13f_performance-smallv2.csv');

async function main() {
  const resolved = path.isAbsolute(csvPath) ? csvPath : path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(resolved)) {
    console.error('File not found:', resolved);
    process.exit(1);
  }
  const buffer = fs.readFileSync(resolved);
  console.log('CSV file:', resolved, '(' + buffer.length, 'bytes)');

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/src/app.module');
  const { HedgeFundsService } = require('../dist/src/hedge-funds/hedge-funds.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const hedgeFundsService = app.get(HedgeFundsService);

  const result = await hedgeFundsService.uploadCsv(buffer);
  console.log('Upload result: processed', result.processed, 'rows');
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
