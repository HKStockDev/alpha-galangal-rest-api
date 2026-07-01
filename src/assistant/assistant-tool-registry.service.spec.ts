import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AssistantToolRegistryService } from './assistant-tool-registry.service';
import { MVP_ALL_TOOL_KEYS } from './assistant.constants';

describe('AssistantToolRegistryService', () => {
  const service = new AssistantToolRegistryService({
    get: () => undefined,
  } as never);

  it('maps tool keys to stable Gemini function names', () => {
    assert.equal(service.toolKeyToGeminiName('tool.client.lookup'), 'tool_client_lookup');
    for (const key of MVP_ALL_TOOL_KEYS) {
      const name = service.toolKeyToGeminiName(key);
      assert.equal(service.geminiNameToToolKey(name), key);
    }
  });
});
