/** Woop list endpoints return either a bare array or `{ [key]: T[] }`. */
export function unwrapWoopList<T>(payload: unknown, listKey: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === 'object' && listKey in payload) {
    const inner = (payload as Record<string, unknown>)[listKey];
    if (Array.isArray(inner)) {
      return inner as T[];
    }
  }
  return [];
}
