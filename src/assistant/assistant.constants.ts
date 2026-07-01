/** Read-only tools exposed to the LLM (Phase 1a + Phase 2 knowledge search). */
export const MVP_READ_TOOL_KEYS = [
  'tool.client.lookup',
  'tool.watchlist.read',
  'tool.formula.read',
  'tool.org.summary',
  'tool.release.status',
  'tool.knowledge.search',
] as const;

/** Non-mutating action tools (Phase 1b). */
export const MVP_ACTION_TOOL_KEYS = ['tool.screen.run', 'tool.formula.explain'] as const;

/** Mutating tools requiring user confirmation before execution (Phase 1b). */
export const MVP_MUTATING_TOOL_KEYS = [
  'tool.watchlist.create',
  'tool.watchlist.add_stocks',
  'tool.watchlist.remove_stocks',
  'tool.formula.create',
  'tool.watchlist.create_from_screen',
] as const;

/** All tools exposed to the LLM. */
export const MVP_ALL_TOOL_KEYS = [
  ...MVP_READ_TOOL_KEYS,
  ...MVP_ACTION_TOOL_KEYS,
  ...MVP_MUTATING_TOOL_KEYS,
] as const;

export const MUTATING_TOOL_KEY_SET = new Set<string>(MVP_MUTATING_TOOL_KEYS);

/** Tools that skip the in-process read cache. */
export const UNCACHEABLE_TOOL_KEYS = new Set<string>([
  'tool.knowledge.search',
  ...MVP_MUTATING_TOOL_KEYS,
  ...MVP_ACTION_TOOL_KEYS,
]);

export const MAX_TOOL_ITERATIONS = 5;

export const DEFAULT_MESSAGE_HISTORY_LIMIT = 30;

export const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;
