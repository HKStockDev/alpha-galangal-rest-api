export type FmpSyncTickerResult =
  | { ok: true; security_id: string }
  | { ok: false; code: 'not_found' | 'filtered'; message: string };

export type FmpSyncPoliticalFeedMissingSecuritiesResult = {
  dryRun: boolean;
  uniqueSymbolsInFeeds: number;
  missingInSecurities: number;
  toProcess: number;
  synced: number;
  filtered: number;
  notFound: number;
  failed: number;
  errors: string[];
};
