import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TestLogService } from '../common/test-log.service';

/** Google retired text-embedding-004; gemini-embedding-001 is the GA replacement. */
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;

/** pgvector literal for Supabase PostgREST (`[1,2,3]`). */
export function formatPgVector(values: number[]): string {
  return `[${values.join(',')}]`;
}

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly config: ConfigService,
    private readonly testLog: TestLogService,
  ) {}

  private getApiKey(): string | undefined {
    return (
      this.config.get<string>('gemini.apiKey') ??
      this.config.get<string>('GEMINI_API_KEY') ??
      process.env.GEMINI_API_KEY
    );
  }

  private getModel(): string {
    return this.config.get<string>('assistant.embeddingModel') ?? DEFAULT_EMBEDDING_MODEL;
  }

  async embedText(text: string): Promise<number[]> {
    const [vector] = await this.embedTexts([text]);
    return vector;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is not configured for embeddings.',
      );
    }

    const cleaned = texts.map((t) => t.trim()).filter((t) => t.length > 0);
    if (cleaned.length === 0) {
      return [];
    }

    const model = this.getModel();
    const modelId = model.startsWith('models/') ? model : `models/${model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:batchEmbedContents?key=${apiKey}`;

    const requests = cleaned.map((text) => ({
      model: modelId,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }));

    this.testLog.log('EmbeddingService.embedTexts', 'ai_request', {
      model,
      texts: cleaned,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(
        Number(this.config.get<string>('ASSISTANT_EMBEDDING_TIMEOUT_MS') ?? 20_000),
      ),
    });

    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }

    if (!res.ok) {
      const err = data?.error as { message?: string } | undefined;
      this.testLog.log('EmbeddingService.embedTexts', 'ai_response_error', {
        model,
        status: res.status,
        error: err?.message ?? `Gemini embedding API error: ${res.status}`,
      });
      throw new InternalServerErrorException(
        err?.message ?? `Gemini embedding API error: ${res.status}`,
      );
    }

    const embeddings = data.embeddings as
      | Array<{ values?: number[] }>
      | undefined;

    if (!embeddings?.length) {
      throw new InternalServerErrorException('Gemini embedding API returned no vectors.');
    }

    const vectors = embeddings.map((row, index) => {
      const values = row.values ?? [];
      if (values.length !== EMBEDDING_DIMENSIONS) {
        throw new InternalServerErrorException(
          `Unexpected embedding size at index ${index}: ${values.length}`,
        );
      }
      return values;
    });

    this.testLog.log('EmbeddingService.embedTexts', 'ai_response', {
      model,
      vectorCount: vectors.length,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    return vectors;
  }
}
