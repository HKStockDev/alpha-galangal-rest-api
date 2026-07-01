import { escapeHtml } from '../marketing/contact/escape-html';

export type TransactionalEmailLayoutParams = {
  preheader: string;
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
};

export function renderTransactionalEmailLayout(p: TransactionalEmailLayoutParams): string {
  const preheader = escapeHtml(p.preheader);
  const title = escapeHtml(p.title);
  const ctaLabel = p.ctaLabel ? escapeHtml(p.ctaLabel) : '';
  const ctaUrl = p.ctaUrl ? escapeHtml(p.ctaUrl) : '';

  const ctaBlock =
    p.ctaLabel && p.ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px 0;">
          <tr>
            <td align="center" bgcolor="#0f172a" style="border-radius:10px;">
              <a href="${ctaUrl}" target="_blank"
                style="display:inline-block;padding:12px 22px;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:20px;color:#ffffff;background-color:#0f172a;border-radius:10px;text-decoration:none;letter-spacing:0.01em;">
                ${ctaLabel}
              </a>
            </td>
          </tr>
        </table>`
      : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${title}</title>
    <style>
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
      @media only screen and (max-width: 600px) {
        .px-card { padding-left: 24px !important; padding-right: 24px !important; }
        .py-card { padding-top: 28px !important; padding-bottom: 28px !important; }
        .h1 { font-size: 22px !important; line-height: 30px !important; }
      }
      @media (prefers-color-scheme: dark) {
        body, .page-bg { background-color: #0b0f14 !important; }
        .card { background-color: #111827 !important; border-color: #1f2937 !important; }
        .heading, .body { color: #e5e7eb !important; }
        .muted { color: #94a3b8 !important; }
        .wordmark { color: #e5e7eb !important; }
      }
    </style>
  </head>
  <body class="page-bg" style="margin:0;padding:0;background-color:#f6f7f8;">
    <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;color:transparent;">
      ${preheader}
    </div>
    <table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" class="page-bg" style="background-color:#f6f7f8;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
            <tr>
              <td align="left" style="padding:0 8px 20px 8px;">
                <span class="wordmark" style="font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;color:#0f172a;">Conviction</span>
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:16px;">
                  <tr>
                    <td class="px-card py-card" style="padding:40px;">
                      <h1 class="h1 heading" style="margin:0 0 16px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;line-height:34px;font-weight:600;color:#0f172a;">${title}</h1>
                      <div class="body" style="font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#1f2937;">
                        ${p.bodyHtml}
                      </div>
                      ${ctaBlock}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 8px 0 8px;">
                <p class="muted" style="margin:0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">
                  Conviction AI LLC · 8401 Mayland Dr, Ste A · Richmond, VA 23294 · USA
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
