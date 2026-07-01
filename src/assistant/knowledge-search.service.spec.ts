import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { EMBEDDING_DIMENSIONS } from './embedding.service';
import { KnowledgeSearchService } from './knowledge-search.service';

describe('KnowledgeSearchService', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('rejects empty query', async () => {
    const service = new KnowledgeSearchService(
      { get: () => undefined } as never,
      { embedText: async () => [] } as never,
      { syncOrganization: async () => ({ indexed: 0, skipped: 0 }) } as never,
    );

    await assert.rejects(
      () =>
        service.search({
          organizationId: 'org-1',
          organizationClientId: null,
          query: '   ',
        }),
      /query is required/,
    );
  });

  it('searches with hybrid RPC after indexing', async () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01);
    const embedText = mock.fn(async () => vector);
    const syncOrganization = mock.fn(async () => ({ indexed: 2, skipped: 1 }));
    const rpc = mock.fn(async () => ({
      data: [
        {
          source_type: 'client_entity_risk_notes',
          source_id: 'entity-1',
          organization_client_id: 'client-1',
          title: 'Primary',
          content: 'Conservative risk profile with liquidity needs.',
          similarity: 0.91,
        },
      ],
      error: null,
    }));

    const service = new KnowledgeSearchService(
      {
        get: (key: string) => {
          if (key === 'assistant.knowledgeSearchTopK') return 5;
          if (key === 'supabase.serviceRoleKey') return 'service-key';
          return undefined;
        },
      } as never,
      { embedText } as never,
      { syncOrganization } as never,
    );

    (service as unknown as { adminClient: unknown }).adminClient = {
      rpc,
    };

    const result = await service.search({
      organizationId: 'org-1',
      organizationClientId: 'client-1',
      query: 'conservative liquidity',
      sourceTypes: ['client_entity_risk_notes'],
      limit: 5,
    });

    assert.equal(syncOrganization.mock.callCount(), 1);
    assert.equal(embedText.mock.callCount(), 1);
    assert.equal(rpc.mock.callCount(), 1);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].snippet.includes('Conservative'), true);
    assert.equal(result.index_stats.indexed, 2);
  });

  it('merges unique Typesense fuzzy hits after vector hits', async () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01);
    const service = new KnowledgeSearchService(
      {
        get: (key: string) => {
          if (key === 'assistant.knowledgeSearchTopK') return 5;
          if (key === 'supabase.serviceRoleKey') return 'service-key';
          if (key === 'assistant.typesenseEnabled') return true;
          return undefined;
        },
      } as never,
      { embedText: async () => vector } as never,
      { syncOrganization: async () => ({ indexed: 0, skipped: 2 }) } as never,
    );

    (service as unknown as { adminClient: unknown }).adminClient = {
      rpc: async () => ({
        data: [
          {
            source_type: 'chat_message',
            source_id: 'msg-1',
            organization_client_id: null,
            title: 'assistant message',
            content: 'This is a semantic hit.',
            similarity: 0.95,
          },
        ],
        error: null,
      }),
    };

    (service as unknown as { searchTypesense: unknown }).searchTypesense = async () => [
      {
        source_type: 'chat_message',
        source_id: 'msg-1',
        organization_client_id: null,
        title: 'assistant message',
        snippet: 'Duplicate fuzzy hit',
        similarity: 0.5,
      },
      {
        source_type: 'formula_release_body',
        source_id: 'release-1',
        organization_client_id: null,
        title: 'Dividend language',
        snippet: 'High-confidence fuzzy match for dividend wording.',
        similarity: 0.7,
      },
    ];

    const result = await service.search({
      organizationId: 'org-1',
      organizationClientId: null,
      query: 'dividend wording',
      limit: 5,
    });

    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].source_id, 'msg-1');
    assert.equal(result.results[1].source_id, 'release-1');
  });

  it('runs live DB fallback when vector hits are placeholder-only', async () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01);
    const syncOrganization = mock.fn(async () => ({ indexed: 0, skipped: 10 }));

    const service = new KnowledgeSearchService(
      {
        get: (key: string) => {
          if (key === 'assistant.knowledgeSearchTopK') return 5;
          if (key === 'supabase.serviceRoleKey') return 'service-key';
          if (key === 'assistant.knowledgeSearchFallbackEnabled') return true;
          if (key === 'assistant.knowledgeSearchMinSimilarity') return 0.55;
          return undefined;
        },
      } as never,
      { embedText: async () => vector } as never,
      { syncOrganization } as never,
    );

    (service as unknown as { adminClient: unknown }).adminClient = {
      rpc: async () => ({
        data: [
          {
            source_type: 'formula_release_body',
            source_id: 'release-seed',
            organization_client_id: null,
            title: 'Sample release',
            content: 'This is placeholder marketing copy. Use the admin panel to replace this body.',
            similarity: 0.71,
          },
        ],
        error: null,
      }),
    };

    (service as unknown as { liveSupplement: unknown }).liveSupplement = async () => ({
      results: [
        {
          source_type: 'formula_description',
          source_id: 'formula-1',
          organization_client_id: null,
          title: 'Hedge Fund Risk',
          snippet: 'Risk-adjusted score favoring lower volatility and beta near 1.',
          similarity: 0.78,
          live_fetch: true,
        },
      ],
      sourcesQueried: ['formulas.description'],
    });

    const result = await service.search({
      organizationId: 'org-1',
      organizationClientId: null,
      query: 'Find releases that emphasize capital preservation and volatility',
      limit: 5,
    });

    assert.equal(result.fallback?.triggered, true);
    assert.equal(result.fallback?.reason, 'all_placeholders');
    assert.equal(result.fallback?.live_hits, 1);
    assert.equal(result.results[0].source_type, 'formula_description');
    assert.equal(result.results[0].live_fetch, true);
  });
});
