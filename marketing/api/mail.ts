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
    // First try with the branded sender (e.g. info@blackruby.de). If Resend
    // rejects with "domain not verified" — common during the gap between
    // adding DNS records and Resend's eu-west-1 DNS cache picking them up —
    // automatically retry with their sandbox sender so the customer still
    // gets the mail. We log a loud warning so this never becomes invisible.
    const FALLBACK_FROM = 'Blackruby <onboarding@resend.dev>';
    const attempt = async (from: string) =>
      resendClient().emails.send({ from, to: [to], subject, html, text: plain });

    try {
      let r = await attempt(MAIL_FROM);
      if (r.error && /not verified/i.test(r.error.message ?? '') && MAIL_FROM !== FALLBACK_FROM) {
        console.warn(`[mail/resend] domain not verified — retrying with ${FALLBACK_FROM}`);
        r = await attempt(FALLBACK_FROM);
      }
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

  const tierLabel = args.tier === 'hustler' ? 'Hustler' : 'Starter';
  const tierBadge = args.tier === 'hustler' ? '#a78bfa' : '#fb7185';
  const html = `
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,sans-serif;color:#e4e4e7;-webkit-font-smoothing:antialiased">
  <!-- Preheader (hidden, shows in inbox preview) -->
  <span style="display:none;max-height:0;overflow:hidden;color:transparent">
    Dein ${tierLabel}-Account ist aktiv. Login direkt mit deiner E-Mail in der App — kein Key zum Kopieren.
  </span>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0a0a0c">
    <tr><td align="center" style="padding:48px 16px 32px">

      <!-- Card -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:linear-gradient(180deg,#13131a 0%,#0f0f14 100%);border:1px solid #27272a;border-radius:24px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(244,63,94,0.25)">

        <!-- Hero header w/ gradient + logo mark -->
        <tr><td style="background:linear-gradient(120deg,#f43f5e 0%,#8b5cf6 50%,#6366f1 100%);padding:0;position:relative">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:28px 36px 0">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle">
                    <!-- Logo mark (SVG-as-data-URI fallback to a CSS shape) -->
                    <div style="width:36px;height:36px;background:rgba(255,255,255,0.18);border-radius:9px;backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.25);display:inline-block;vertical-align:middle"></div>
                  </td>
                  <td style="padding-left:14px;vertical-align:middle">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.85)">Blackruby</div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px">Hustle Engine</div>
                  </td>
                </tr>
              </table>
            </td></tr>
            <tr><td style="padding:24px 36px 36px">
              <div style="display:inline-block;background:rgba(0,0,0,0.25);color:#fff;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.2);margin-bottom:16px">
                ✓ Payment received
              </div>
              <h1 style="margin:0;color:#fff;font-size:34px;font-weight:800;letter-spacing:-0.025em;line-height:1.15">
                Du bist drin.
              </h1>
              <p style="margin:10px 0 0;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.5;max-width:440px">
                Deine ${tierLabel}-Lizenz ist freigeschaltet. Lade die App, logge dich mit dieser E-Mail-Adresse ein — das war's.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Plan summary -->
        <tr><td style="padding:28px 36px 8px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(255,255,255,0.025);border:1px solid #27272a;border-radius:14px">
            <tr>
              <td style="padding:18px 22px;vertical-align:middle">
                <div style="font-size:10px;color:#71717a;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px">Dein Plan</div>
                <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.01em;line-height:1.1">${tierLabel}</div>
              </td>
              <td style="padding:18px 22px;vertical-align:middle;text-align:right">
                <div style="font-size:10px;color:#71717a;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px">Monatlich</div>
                <div style="font-size:22px;font-weight:800;color:${tierBadge};font-variant-numeric:tabular-nums;letter-spacing:-0.01em">${args.amountEur.toFixed(2)} €</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Login card (replaces license-key card) -->
        <tr><td style="padding:16px 36px 8px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(180deg,rgba(244,63,94,0.07),rgba(99,102,241,0.05));border:1px solid rgba(244,63,94,0.25);border-radius:14px">
            <tr><td style="padding:22px 24px">
              <div style="font-size:10px;color:#fda4af;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:10px;font-weight:700">
                ▸ So loggst du dich ein
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:6px 0">
                    <div style="font-size:10px;color:#71717a;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">E-Mail</div>
                    <div style="font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;font-weight:600;color:#e4e4e7;word-break:break-all">${args.to}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0 0">
                    <div style="font-size:10px;color:#71717a;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">Passwort</div>
                    <div style="font-size:13px;color:#a1a1aa">Das, das du beim Checkout gesetzt hast. Vergessen? <a href="${PUBLIC_URL}/login" style="color:#fb7185;text-decoration:underline">Zurücksetzen</a>.</div>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;color:#71717a;font-size:12px;line-height:1.5">
                Kein Lizenz-Key zum Kopieren mehr. Dein Account-Login ist deine Lizenz. Solange dein Abo aktiv ist, läuft die App.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <!-- CTAs -->
        <tr><td style="padding:24px 36px 8px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="50%" style="padding-right:6px">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(120deg,#f43f5e 0%,#8b5cf6 60%,#6366f1 100%);border-radius:12px">
                  <tr><td align="center">
                    <a href="${PUBLIC_URL}/downloads" style="display:block;padding:14px 18px;color:#fff;font-weight:700;font-size:14px;text-decoration:none;letter-spacing:0.01em">
                      App herunterladen
                    </a>
                  </td></tr>
                </table>
              </td>
              <td width="50%" style="padding-left:6px">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(255,255,255,0.04);border:1px solid #27272a;border-radius:12px">
                  <tr><td align="center">
                    <a href="${PUBLIC_URL}/members" style="display:block;padding:13px 18px;color:#e4e4e7;font-weight:600;font-size:14px;text-decoration:none">
                      Member-Space öffnen
                    </a>
                  </td></tr>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Step list -->
        <tr><td style="padding:28px 36px 8px">
          <div style="font-size:11px;color:#71717a;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:16px;font-weight:700">Was jetzt</div>
          ${stepRow('1', 'App installieren', 'Installer für Mac (.dmg) oder Windows (.msi)')}
          ${stepRow('2', 'Einloggen', 'Mit dieser E-Mail + deinem Account-Passwort')}
          ${stepRow('3', 'Wizard durchlaufen', '5 min — Vinted-Login, CJ-API-Key, Preise')}
          ${stepRow('4', 'Hustle läuft', 'Auto-Publisher startet, erste Sales nach 24–72 h')}
        </td></tr>

        <!-- Support footer -->
        <tr><td style="padding:24px 36px 32px">
          <hr style="border:none;border-top:1px solid #27272a;margin:0 0 18px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size:12px;color:#71717a;line-height:1.6">
                <div style="color:#a1a1aa;font-weight:600;margin-bottom:4px">Brauchst du Hilfe?</div>
                Antworte einfach auf diese Mail.<br>
                7 Tage Geld-zurück über <a href="${PUBLIC_URL}/members" style="color:#fda4af">Member-Space</a> → Abo verwalten.
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Brand footer -->
        <tr><td style="background:rgba(0,0,0,0.4);padding:18px 36px;border-top:1px solid #27272a">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size:10px;color:#52525b;letter-spacing:0.15em;text-transform:uppercase">
                Blackruby · ${new Date().getFullYear()}
              </td>
              <td style="font-size:11px;color:#52525b;text-align:right">
                <a href="${PUBLIC_URL}" style="color:#52525b;text-decoration:none">${PUBLIC_URL.replace(/^https?:\/\//, '')}</a>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>

      <!-- Mini footer below card -->
      <p style="margin:18px 0 0;color:#3f3f46;font-size:10px;line-height:1.5;max-width:540px">
        Diese E-Mail wurde an ${args.to} verschickt weil ein ${tierLabel}-Abo auf dieser Adresse aktiviert wurde. Wenn das nicht du warst — antworte uns sofort.
      </p>

    </td></tr>
  </table>
</body>
</html>`;

  await send(args.to, subject, html);
}

function stepRow(num: string, title: string, body: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:12px">
      <tr>
        <td width="36" style="vertical-align:top;padding-top:2px">
          <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#f43f5e,#6366f1);color:#fff;font-weight:800;font-size:13px;line-height:28px;text-align:center;font-family:'JetBrains Mono',ui-monospace,monospace">${num}</div>
        </td>
        <td style="vertical-align:top;padding-left:10px">
          <div style="font-size:14px;font-weight:700;color:#fff;line-height:1.3">${title}</div>
          <div style="font-size:13px;color:#a1a1aa;margin-top:3px;line-height:1.5">${body}</div>
        </td>
      </tr>
    </table>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Password-reset email — fires from /api/auth/forgot with a single-use token
// ──────────────────────────────────────────────────────────────────────────────
export async function sendPasswordResetEmail(args: { to: string; resetUrl: string }) {
  const subject = 'Blackruby · Passwort zurücksetzen';
  const html = `
<!doctype html>
<html lang="de">
<body style="margin:0;background:#0a0a0c;font-family:-apple-system,Inter,sans-serif;color:#e4e4e7;padding:40px 20px">
  <table role="presentation" cellpadding="0" cellspacing="0" width="560" align="center" style="max-width:560px;background:#13131a;border:1px solid #27272a;border-radius:16px;overflow:hidden">
    <tr><td style="background:linear-gradient(120deg,#f43f5e,#8b5cf6,#6366f1);padding:28px 32px;color:#fff;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;font-size:13px">BLACKRUBY</td></tr>
    <tr><td style="padding:32px">
      <h1 style="margin:0 0 12px 0;font-size:24px;color:#fff">Passwort zurücksetzen</h1>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6">
        Klick auf den Button um ein neues Passwort zu setzen. Der Link ist 30 Minuten gültig
        und nur einmal verwendbar.
      </p>
      <table role="presentation" style="margin:24px 0"><tr><td style="background:linear-gradient(120deg,#f43f5e,#6366f1);border-radius:12px">
        <a href="${args.resetUrl}" style="display:inline-block;padding:14px 28px;color:#fff;font-weight:700;text-decoration:none">Passwort zurücksetzen →</a>
      </td></tr></table>
      <p style="color:#71717a;font-size:12px;line-height:1.6">
        Wenn du das nicht angefordert hast: ignorier diese Mail. Dein Account bleibt unverändert.
        Aus Sicherheitsgründen verraten wir nicht ob diese E-Mail existiert — nur falls ja, kommt diese Mail.
      </p>
      <hr style="border:none;border-top:1px solid #27272a;margin:24px 0">
      <p style="color:#52525b;font-size:11px;line-height:1.5">
        Funktioniert der Button nicht? Kopier den Link in deinen Browser:<br>
        <span style="color:#71717a;word-break:break-all">${args.resetUrl}</span>
      </p>
    </td></tr>
  </table>
</body></html>`;
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
