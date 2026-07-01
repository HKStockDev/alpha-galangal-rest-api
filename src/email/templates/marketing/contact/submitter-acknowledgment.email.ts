import type { MarketingContactFormPayload } from './types';
import { escapeHtml } from './escape-html';

const SUBJECT = 'We got your message — Precision';

export function renderSubmitterAcknowledgmentEmail(p: MarketingContactFormPayload): {
  subject: string;
  html: string;
  text: string;
} {
  // HTML: escape all user-controlled fields (including message) before insertion — no raw HTML in email body.
  const name = escapeHtml(p.name);
  const firm = escapeHtml(p.firm);
  const role = escapeHtml(p.role);
  const email = escapeHtml(p.email);
  const message = escapeHtml(p.message);

  // Plain text: no HTML execution; use raw copy for natural line breaks (separate from HTML-escaped branch).
  const text = `Thanks for reaching out, ${p.name}.
We just received your message at Precision. A human on our team will review it
and get back to you within one business day.
In the meantime, if you'd like to skip ahead, you can book a personalized demo:
https://www.withprecision.ai/demo
---
What we received
Firm: ${p.firm}
Role: ${p.role}
Email: ${p.email}
Your message:
${p.message}
---
— The Precision team
Precision AI LLC · 8401 Mayland Dr, Ste A · Richmond, VA 23294 · USA`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>We received your message</title>
    <!--[if mso]>
      <style>
        table, td, div, h1, h2, h3, p, a { font-family: Arial, Helvetica, sans-serif !important; }
      </style>
    <![endif]-->
    <style>
      /* Prevent iOS from auto-styling phone numbers and emails. */
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
      /* Mobile: tighten paddings and stack. */
      @media only screen and (max-width: 600px) {
        .px-card { padding-left: 24px !important; padding-right: 24px !important; }
        .py-card { padding-top: 28px !important; padding-bottom: 28px !important; }
        .stack-block { display: block !important; width: 100% !important; }
        .h1 { font-size: 22px !important; line-height: 30px !important; }
      }
      /* Email clients that honor prefers-color-scheme. */
      @media (prefers-color-scheme: dark) {
        body, .page-bg { background-color: #0b0f14 !important; }
        .card { background-color: #111827 !important; border-color: #1f2937 !important; }
        .heading, .body, .label, .quote-body { color: #e5e7eb !important; }
        .muted { color: #94a3b8 !important; }
        .divider { border-color: #1f2937 !important; }
        .quote { background-color: #0b1220 !important; border-color: #1f2937 !important; }
        .wordmark { color: #e5e7eb !important; }
        .footer-text, .footer-link { color: #94a3b8 !important; }
        .footer-link { color: #cbd5e1 !important; }
      }
    </style>
  </head>
  <body
    class="page-bg"
    style="margin:0;padding:0;background-color:#f6f7f8;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;"
  >
    <!-- Preheader (hidden preview text) -->
    <div
      style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;color:transparent;mso-hide:all;"
    >
      Thanks, ${name} — a human on our team will reply within one business day.
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
            <!-- Brand bar -->
            <tr>
              <td align="left" style="padding:0 8px 20px 8px;">
                <!--
                  To use a hosted logo instead of the wordmark, replace this <span> with:
                  <img src="https://www.withprecision.ai/logos/precision-light-full.png"
                       width="160" height="32" alt="Precision"
                       style="display:block;border:0;outline:none;text-decoration:none;height:32px;width:auto;" />
                -->
                <span
                  class="wordmark"
                  style="font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;"
                >
                  Precision
                </span>
              </td>
            </tr>
            <!-- Main card -->
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
                    <td class="px-card py-card" style="padding:40px 40px 32px 40px;">
                      <h1
                        class="h1 heading"
                        style="margin:0 0 16px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;line-height:34px;font-weight:600;letter-spacing:-0.02em;color:#0f172a;"
                      >
                        Thanks for reaching out, ${name}.
                      </h1>
                      <p
                        class="body"
                        style="margin:0 0 12px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#1f2937;"
                      >
                        We just received your message at Precision. A human on our team will
                        review it and get back to you
                        <strong style="color:#0f172a;">within one business day</strong>.
                      </p>
                      <p
                        class="body"
                        style="margin:0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#1f2937;"
                      >
                        In the meantime, if you'd like to skip ahead, you can book a personalized
                        demo any time.
                      </p>
                      <!-- CTA button -->
                      <table
                        role="presentation"
                        cellpadding="0"
                        cellspacing="0"
                        border="0"
                        style="margin:28px 0 4px 0;"
                      >
                        <tr>
                          <td
                            align="center"
                            bgcolor="#0f172a"
                            style="border-radius:10px;"
                          >
                            <a
                              href="https://www.withprecision.ai/demo"
                              target="_blank"
                              style="display:inline-block;padding:12px 22px;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:20px;color:#ffffff;background-color:#0f172a;border-radius:10px;text-decoration:none;letter-spacing:0.01em;"
                            >
                              Book a demo &rarr;
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <!-- Divider -->
                  <tr>
                    <td style="padding:0 40px;" class="px-card">
                      <div
                        class="divider"
                        style="border-top:1px solid #e5e7eb;line-height:0;font-size:0;"
                      >
                        &nbsp;
                      </div>
                    </td>
                  </tr>
                  <!-- Submitted message recap -->
                  <tr>
                    <td class="px-card" style="padding:28px 40px 8px 40px;">
                      <p
                        class="label muted"
                        style="margin:0 0 12px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;"
                      >
                        What we received
                      </p>
                      <table
                        role="presentation"
                        width="100%"
                        cellpadding="0"
                        cellspacing="0"
                        border="0"
                      >
                        <tr>
                          <td
                            class="muted"
                            style="padding:4px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;width:90px;"
                          >
                            Firm
                          </td>
                          <td
                            class="body"
                            style="padding:4px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#1f2937;"
                          >
                            ${firm}
                          </td>
                        </tr>
                        <tr>
                          <td
                            class="muted"
                            style="padding:4px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;"
                          >
                            Role
                          </td>
                          <td
                            class="body"
                            style="padding:4px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#1f2937;"
                          >
                            ${role}
                          </td>
                        </tr>
                        <tr>
                          <td
                            class="muted"
                            style="padding:4px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;"
                          >
                            Email
                          </td>
                          <td
                            class="body"
                            style="padding:4px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#1f2937;"
                          >
                            ${email}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="px-card" style="padding:16px 40px 36px 40px;">
                      <div
                        class="quote"
                        style="background-color:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#0f172a;white-space:pre-wrap;"
                      >
                        <span class="quote-body" style="color:#0f172a;">${message}</span>
                      </div>
                    </td>
                  </tr>
                  <!-- Sign-off -->
                  <tr>
                    <td class="px-card" style="padding:0 40px 40px 40px;">
                      <p
                        class="body"
                        style="margin:0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#1f2937;"
                      >
                        — The Precision team
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td align="center" style="padding:24px 16px 8px 16px;">
                <p
                  class="footer-text muted"
                  style="margin:0 0 6px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;"
                >
                  Precision AI LLC &middot; 8401 Mayland Dr, Ste A &middot; Richmond, VA 23294 &middot; USA
                </p>
                <p
                  class="footer-text muted"
                  style="margin:0 0 14px 0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;"
                >
                  You're receiving this email because you contacted us through withprecision.ai.
                </p>
                <p
                  style="margin:0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;"
                >
                  <a
                    class="footer-link"
                    href="https://www.withprecision.ai"
                    target="_blank"
                    style="color:#475569;text-decoration:none;"
                  >Website</a>
                  &nbsp;&middot;&nbsp;
                  <a
                    class="footer-link"
                    href="https://www.withprecision.ai/privacy"
                    target="_blank"
                    style="color:#475569;text-decoration:none;"
                  >Privacy</a>
                  &nbsp;&middot;&nbsp;
                  <a
                    class="footer-link"
                    href="https://www.withprecision.ai/terms"
                    target="_blank"
                    style="color:#475569;text-decoration:none;"
                  >Terms</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: SUBJECT, html, text };
}
