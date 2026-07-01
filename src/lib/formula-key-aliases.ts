export const LEGACY_COMMITTEE_KEY_PREFIX = 'alpha_galangal_committee_';

export function expandFormulaKeyAliases(key: string): string[] {
  const keys: string[] = [key];
  if (key.startsWith(LEGACY_COMMITTEE_KEY_PREFIX)) {
    const stripped = key.slice(LEGACY_COMMITTEE_KEY_PREFIX.length);
    if (stripped) keys.push(stripped);
  } else {
    keys.push(`${LEGACY_COMMITTEE_KEY_PREFIX}${key}`);
  }
  return [...new Set(keys)];
}
