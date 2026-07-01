/** For logs only; avoids storing full addresses in log aggregators. */
export function maskEmailForLogs(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at < 1) return '(invalid-email)';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain) return '(invalid-email)';
  const masked =
    local.length <= 2 ? '**' : `${local[0]}***${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}
