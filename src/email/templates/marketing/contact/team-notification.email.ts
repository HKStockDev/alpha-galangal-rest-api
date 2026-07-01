import type { MarketingContactFormPayload } from './types';
import { escapeHtml } from './escape-html';

export function renderTeamNotificationEmail(p: MarketingContactFormPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `New contact form: ${p.name}${p.firm ? ` (${p.firm})` : ''}`;

  const text = `Someone submitted the marketing contact form.

Name: ${p.name}
Firm: ${p.firm}
Email: ${p.email}
Role: ${p.role}

Message:
${p.message}

Reply: mailto:${p.email}`;

  const e = (s: string) => escapeHtml(s);
  const name = e(p.name);
  const firm = e(p.firm);
  const email = e(p.email);
  const role = e(p.role);
  const message = e(p.message);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>New contact submission</title>
    <!--[if mso]>
      <style>
        table, td, div, h1, p, a { font-family: Arial, Helvetica, sans-serif !important; }
      </style>
    <![endif]-->
    <style>
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
      @media only screen and (max-width: 600px) {
        .px-card { padding-left: 24px !important; padding-right: 24px !important; }
      }
      @media (prefers-color-scheme: dark) {
        body, .page-bg { background-color: #0b0f14 !important; }
        .card { background-color: #111827 !important; border-color: #1f2937 !important; }
        .heading, .body, .label { color: #e5e7eb !important; }
        .muted { color: #94a3b8 !important; }
        .value { color: #e5e7eb !important; }
        .divider { border-color: #1f2937 !important; }
        .quote { background-color: #0b1220 !important; border-color: #1f2937 !important; }
        .wordmark { color: #e5e7eb !important; }
        .footer-text { color: #94a3b8 !important; }
        .link { color: #93c5fd !important; }
      }
    </style>
  </head>
  <body
    class="page-bg"
    style="margin:0;padding:0;background-color:#f6f7f8;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;"
  >
    <div
      style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;color:transparent;mso-hide:all;"
    >
      New submission from ${name} · ${firm}
      &#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;&#8202;
    </div>
    <table
      role="presentation"
      align="center"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      class="page-bg"
      style="background-color:#f6f7f8;"
    >
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table
            role="presentation"
            align="center"
            width="600"
            cellpadding="0"
            cellspacing="0"
            border="0"
            style="width:600px;max-width:600px;"
          >
            <tr>
              <td align="left" style="padding:0 8px 20px 8px;">
                <span
                  class="wordmark"
                  style="font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;"
                >
                  Conviction
                </span>
                <span
                  style="font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:500;color:#64748b;margin-left:10px;"
                >
                  Internal · Contact form
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <table
                  role="presentation"
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  class="card"
                  style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 1px 2px rgba(15,23,42,0.04);overflow:hidden;"
                >
                  <tr>
                    <td class="px-card" style="padding:36px 40px 28px 40px;">
                      <h1
                        class="heading"
                        style="margin:0 0 8px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.02em;color:#0f172a;"
                      >
                        New contact submission
                      </h1>
                      <p
                        class="muted"
                        style="margin:0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#64748b;"
                      >
                        Submitted via withconviction.ai
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 40px;" class="px-card">
                      <div class="divider" style="border-top:1px solid #e5e7eb;line-height:0;font-size:0;">&nbsp;</div>
                    </td>
                  </tr>
                  <tr>
                    <td class="px-card" style="padding:28px 40px 12px 40px;">
                      <p
                        class="label muted"
                        style="margin:0 0 14px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;"
                      >
                        Lead details
                      </p>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td class="muted" style="padding:6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;width:88px;vertical-align:top;">Name</td>
                          <td class="value body" style="padding:6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#1f2937;">${name}</td>
                        </tr>
                        <tr>
                          <td class="muted" style="padding:6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;vertical-align:top;">Firm</td>
                          <td class="value body" style="padding:6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#1f2937;">${firm}</td>
                        </tr>
                        <tr>
                          <td class="muted" style="padding:6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;vertical-align:top;">Email</td>
                          <td class="value body" style="padding:6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#1f2937;">
                            <a class="link" href="mailto:${email}" style="color:#0f172a;text-decoration:underline;text-underline-offset:2px;">${email}</a>
                          </td>
                        </tr>
                        <tr>
                          <td class="muted" style="padding:6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;vertical-align:top;">Role</td>
                          <td class="value body" style="padding:6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#1f2937;">${role}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="px-card" style="padding:8px 40px 36px 40px;">
                      <p
                        class="label muted"
                        style="margin:0 0 12px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;"
                      >
                        Message
                      </p>
                      <div
                        class="quote"
                        style="background-color:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#0f172a;white-space:pre-wrap;"
                      >
                        <span style="color:#0f172a;">${message}</span>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td class="px-card" style="padding:0 40px 36px 40px;">
                      <p class="body muted" style="margin:0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;">
                        Reply:
                        <a class="link" href="mailto:${email}" style="color:#0f172a;font-weight:600;text-decoration:underline;">${email}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 16px 8px 16px;">
                <p
                  class="footer-text"
                  style="margin:0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:16px;color:#94a3b8;"
                >
                  Conviction AI LLC · Internal notification only
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
