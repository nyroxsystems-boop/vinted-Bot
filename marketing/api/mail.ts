// ──────────────────────────────────────────────────────────────────────────────
// Mail service — sends license keys + transactional notifications.
//
// Primary transport: Resend (https://resend.com) — set RESEND_API_KEY.
// Optional fallback: SMTP via nodemailer if SMTP_PASS is set (kept around
// so we can pivot back to Plesk/Strato later without code churn).
// Dev fallback: console-only logging if neither RESEND_API_KEY nor SMTP_PASS
// is configured.
//
// FROM address comes from MAIL_FROM (preferred) or SMTP_FROM (legacy).
// Default 'Blackruby <info@blackruby.de>'. When using Resend, the sending
// domain must be verified in the Resend dashboard.
//
// THROWS on failure so callers can decide to retry — previously errors were
// silently swallowed and the webhook returned 200 even with no email out.
// ──────────────────────────────────────────────────────────────────────────────

import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const SMTP_HOST = process.env.SMTP_HOST ?? '';
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);
const SMTP_USER = process.env.SMTP_USER ?? 'info@blackruby.de';
const SMTP_PASS = process.env.SMTP_PASS ?? '';
const MAIL_FROM = process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? 'Blackruby <info@blackruby.de>';

let _resend: Resend | null = null;
function resendClient(): Resend {
  if (!_resend) _resend = new Resend(RESEND_API_KEY);
  return _resend;
}

let _smtp: Transporter | null = null;
function smtpClient(): Transporter {
  if (!_smtp) {
    _smtp = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return _smtp;
}

async function send(to: string, subject: string, html: string, text?: string) {
  const plain = text ?? stripHtml(html);

  // Path 1: Resend (recommended for production)
  if (RESEND_API_KEY) {
    try {
      const r = await resendClient().emails.send({
        from: MAIL_FROM,
        to: [to],
        subject,
        html,
        text: plain,
      });
      if (r.error) throw new Error(`resend: ${r.error.name} — ${r.error.message}`);
      console.log(`[mail/resend] sent "${subject}" → ${to} · id=${r.data?.id}`);
      return;
    } catch (e) {
      console.error(`[mail/resend] FAILED "${subject}" → ${to}:`, e);
      throw e;
    }
  }

  // Path 2: SMTP fallback (kept for emergency use / dev with real mailbox)
  if (SMTP_PASS && SMTP_HOST) {
    try {
      const info = await smtpClient().sendMail({
        from: MAIL_FROM,
        to,
        subject,
        html,
        text: plain,
      });
      console.log(`[mail/smtp] sent "${subject}" → ${to} · id=${info.messageId}`);
      return;
    } catch (e) {
      console.error(`[mail/smtp] FAILED "${subject}" → ${to}:`, e);
      throw e;
    }
  }

  // Path 3: dev console
  console.warn(`[mail/dev] no provider configured — would send "${subject}" → ${to}`);
  console.log(html);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+\n/g, '\n').trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// License email — fires after checkout.session.completed
// ──────────────────────────────────────────────────────────────────────────────
export async function sendLicenseEmail(args: {
  to: string;
  licenseKey: string;
  tier: 'starter' | 'hustler';
  amountEur: number;
}) {
  const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://blackruby.de';
  const subject = `Dein Blackruby-Lizenzkey · ${args.tier.toUpperCase()}`;

  const html = `
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#e4e4e7">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0a0a0c;padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#13131a;border:1px solid #27272a;border-radius:16px;overflow:hidden">
        <!-- Header -->
        <tr><td style="background:linear-gradient(120deg,#f43f5e 0%,#8b5cf6 60%,#6366f1 100%);padding:32px 32px;color:#fff;font-size:14px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase">
          BLACKRUBY · HUSTLE ENGINE
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 32px">
          <h1 style="margin:0 0 12px 0;font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.02em">Willkommen an Bord! 🚀</h1>
          <p style="margin:0 0 24px 0;color:#a1a1aa;font-size:15px;line-height:1.6">
            Deine Zahlung ist eingegangen. Hier ist dein Lizenzkey — kopier ihn beim
            ersten Start in der Blackruby-App und du bist sofort unlocked.
          </p>

          <!-- License key card -->
          <div style="background:#0a0a0c;border:1px solid #f43f5e40;border-radius:12px;padding:20px;margin:0 0 24px 0">
            <div style="font-size:11px;color:#71717a;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px">Dein Lizenzkey</div>
            <div style="font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:700;color:#fda4af;letter-spacing:0.06em;word-break:break-all">${args.licenseKey}</div>
            <div style="margin-top:12px;font-size:12px;color:#71717a">
              Tier: <strong style="color:#e4e4e7;text-transform:capitalize">${args.tier}</strong> ·
              Betrag: <strong style="color:#e4e4e7">${args.amountEur.toFixed(2)} €/Monat</strong>
            </div>
          </div>

          <!-- CTA -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="background:linear-gradient(120deg,#f43f5e 0%,#8b5cf6 60%,#6366f1 100%);border-radius:12px">
              <a href="${PUBLIC_URL}/downloads" style="display:inline-block;padding:14px 28px;color:#fff;font-weight:700;font-size:15px;text-decoration:none">
                App herunterladen →
              </a>
            </td></tr>
          </table>

          <h3 style="margin:32px 0 12px 0;font-size:16px;color:#fff">Was jetzt?</h3>
          <ol style="margin:0;padding-left:20px;color:#a1a1aa;font-size:14px;line-height:1.7">
            <li>Installer für Mac (.dmg) oder Windows (.msi) laden</li>
            <li>Beim ersten Start den Lizenzkey eingeben</li>
            <li>Wizard durchlaufen (Vinted-Login, CJ-API-Key, Preise — 5 min)</li>
            <li>Fotos rein, Auto-Publisher startet — erste Sales nach 24–72 h</li>
          </ol>

          <h3 style="margin:32px 0 12px 0;font-size:16px;color:#fff">Member-Space</h3>
          <p style="margin:0 0 16px 0;color:#a1a1aa;font-size:14px;line-height:1.6">
            Login unter <a href="${PUBLIC_URL}/members" style="color:#fda4af;text-decoration:underline">${PUBLIC_URL}/members</a>
            — Lizenz-Übersicht, Abo verwalten, Live-Chat mit dem Team und anderen Hustlern.
          </p>

          <hr style="border:none;border-top:1px solid #27272a;margin:32px 0">
          <p style="margin:0;color:#71717a;font-size:12px;line-height:1.6">
            Probleme? Antworte einfach auf diese Mail — wir sind auf info@blackruby.de erreichbar.
            Refund (7-Tage Geld-zurück): unter ${PUBLIC_URL}/members → Abo verwalten.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#09090b;padding:20px 32px;color:#52525b;font-size:11px;text-align:center">
          Blackruby · ${new Date().getFullYear()} · ${PUBLIC_URL}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await send(args.to, subject, html);
}

// ──────────────────────────────────────────────────────────────────────────────
// Welcome email — fires on user-account registration (no purchase yet)
// ──────────────────────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(args: { to: string }) {
  const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://blackruby.de';
  const subject = 'Willkommen bei Blackruby';
  const html = `
<!doctype html>
<html lang="de">
<body style="margin:0;background:#0a0a0c;font-family:-apple-system,Inter,sans-serif;color:#e4e4e7;padding:40px 20px">
  <table role="presentation" cellpadding="0" cellspacing="0" width="560" align="center" style="max-width:560px;background:#13131a;border:1px solid #27272a;border-radius:16px;overflow:hidden">
    <tr><td style="background:linear-gradient(120deg,#f43f5e,#8b5cf6,#6366f1);padding:28px 32px;color:#fff;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;font-size:13px">BLACKRUBY</td></tr>
    <tr><td style="padding:32px">
      <h1 style="margin:0 0 12px 0;font-size:24px;color:#fff">Account angelegt</h1>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6">
        Du bist eingeloggt im Member-Space unter
        <a href="${PUBLIC_URL}/members" style="color:#fda4af">${PUBLIC_URL}/members</a>.
      </p>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6">
        Noch kein Plan? Hol dir eine Lizenz für 99 € oder 199 € pro Monat —
        monatlich kündbar.
      </p>
      <table role="presentation"><tr><td style="background:linear-gradient(120deg,#f43f5e,#6366f1);border-radius:12px">
        <a href="${PUBLIC_URL}/pricing" style="display:inline-block;padding:12px 24px;color:#fff;font-weight:700;text-decoration:none">Plan wählen →</a>
      </td></tr></table>
    </td></tr>
  </table>
</body></html>`;
  await send(args.to, subject, html);
}
