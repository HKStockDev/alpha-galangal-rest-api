/**
 * Removes Linear-style ticket references (CON-123, SKE-45) from user-facing copy.
 * Strips leading "CON-123: " prefixes and parenthetical "(SKE-36)" / "(CON-53 …)" segments.
 */
export function stripLinearTicketRefs(value: string | null | undefined): string | null {
  if (value == null) return null;
  let text = value.trim();
  if (!text) return null;

  text = text.replace(/^\s*(?:CON|SKE)-\d+:\s*/i, '');
  text = text.replace(/\s*\((?:CON|SKE)-\d+[^)]*\)/gi, '');
  text = text.replace(/\s+\./g, '.');
  text = text.replace(/\s{2,}/g, ' ').trim();

  return text || null;
}
