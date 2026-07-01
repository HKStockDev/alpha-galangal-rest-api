/** US Congress number from calendar year (House.gov / conventional formula). */
export const CONGRESS_TERM_START_YEAR = 1789;

export function getCurrentCongressNumber(): number {
  const year = new Date().getFullYear();
  return Math.floor((year - CONGRESS_TERM_START_YEAR) / 2) + 1;
}
