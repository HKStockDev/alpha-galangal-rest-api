import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingService,
  formatPgVector,
} from './embedding.service';

describe('EmbeddingService', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('formats pgvector literals', () => {
    assert.equal(formatPgVector([1, 2, 3]), '[1,2,3]');
  });

  it('embeds text via Gemini batch API', async () => {
    const values = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i * 0.001);
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({ embeddings: [{ values }] }),
    );

    const service = new EmbeddingService(
      {
        get: (key: string) => {
          if (key === 'gemini.apiKey') return 'test-key';
          if (key === 'assistant.embeddingModel') return 'gemini-embedding-001';
          return undefined;
        },
      } as never,
      { log: () => {} } as never,
    );

    const result = await service.embedText('risk tolerance notes');
    assert.equal(result.length, EMBEDDING_DIMENSIONS);
    assert.equal(fetchMock.mock.callCount(), 1);
    const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.match(url, /gemini-embedding-001:batchEmbedContents/);
    const body = JSON.parse(String(init.body));
    assert.equal(body.requests[0].content.parts[0].text, 'risk tolerance notes');
    assert.equal(body.requests[0].outputDimensionality, EMBEDDING_DIMENSIONS);
  });
});
