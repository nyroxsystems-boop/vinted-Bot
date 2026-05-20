# Blackruby — Sales-Ready Guide

This repository now ships **two** Vite/React surfaces:

| Surface     | Path                    | Port | Purpose                                                          |
| ----------- | ----------------------- | ---: | ---------------------------------------------------------------- |
| `dashboard` | `system/dashboard/`     | 5173 | In-app Tauri UI (Blackruby desktop app)                          |
| `marketing` | `system/marketing/`     | 5180 | Public landing page, `/pricing`, `/members`, `/downloads`        |
| `marketing-api` | `system/marketing/api/` | 5181 | Stripe checkout, license issuance, release manifest, validation  |

## Quick start (local dev)

```bash
# install
cd system && npm install

# run dashboard (Tauri shell)
npm run dev:dashboard          # localhost:5173

# run marketing site
npm run dev:marketing          # localhost:5180

# run marketing API (Stripe-aware; falls back to MOCK mode without keys)
npm run dev:marketing-api      # localhost:5181
```

The dashboard ships with `.env.local` that bypasses the license gate
(`VITE_BYPASS_LICENSE=true`) so the desktop app boots cleanly during development.
Production builds (`npm run -w @vinted-system/dashboard build`) ignore that file.

## Production wiring

### 1. Stripe
Create three Stripe products and copy the price IDs into `marketing/.env`:

```env
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_STARTER_MONTHLY=price_xxx
STRIPE_PRICE_STARTER_YEARLY=price_xxx
STRIPE_PRICE_HUSTLER_MONTHLY=price_xxx
STRIPE_PRICE_HUSTLER_YEARLY=price_xxx
STRIPE_PRICE_LIFETIME=price_xxx
LICENSE_SIGNING_SECRET=$(openssl rand -hex 32)
PUBLIC_URL=https://blackruby.app
```

Configure the webhook endpoint in Stripe to point at
`https://blackruby.app/api/stripe/webhook` and subscribe to:

- `checkout.session.completed`
- `customer.subscription.deleted`

### 2. License gate
The desktop app validates the customer's key against
`POST /api/license/validate` on first activation, persists the signed payload
in `localStorage`, and re-checks every 24 h in the background. If the marketing
API is offline, a previously-stored valid license keeps working until expiry.

### 3. Building installers

```bash
# from system/
./scripts/release.sh
```

This produces signed installers under `dist/release/<version>/` plus a
`releases.json` manifest that the marketing API serves at
`/api/releases/latest`. The download page on the marketing site picks it up
automatically.

Required toolchains:

- **macOS host**: `xcode-select --install`, `rustup target add aarch64-apple-darwin x86_64-apple-darwin`. For notarization, set `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` env vars before invoking `tauri build`.
- **Windows host**: `rustup target add x86_64-pc-windows-msvc`; WiX Toolset is fetched automatically by `cargo-tauri`. Set `BLACKRUBY_BUILD_WIN=1` when invoking `release.sh` from a cross-compile host.

### 4. Auto-Updates
`tauri.conf.json → plugins.updater.endpoints` points at
`https://blackruby.app/api/releases/{{target}}/{{current_version}}`. Generate
an Ed25519 signing keypair with `tauri signer generate` and set the public key
in the `pubkey` field; sign each release artifact with the private key.

## Sales-ready checklist

- [x] Landing page (`/`) with hero, features, how-it-works, pricing teaser, FAQ, CTA
- [x] Pricing page (`/pricing`) with Starter / Hustler / Lifetime tiers, monthly/yearly toggle
- [x] Members page (`/members`) with email+key lookup, resend by email
- [x] Stripe Checkout integration (mock mode for dev, real keys for prod)
- [x] License issuance via webhook + immediate fallback on `/success`
- [x] License validation API with HMAC-signed payloads (offline-tolerant clients)
- [x] Desktop license gate with persistent storage + 24h revalidation
- [x] First-run onboarding wizard (Vinted, CJ, pricing, crosslist targets)
- [x] Polished dashboard: emoji-free defaults, CSS toggles, smooth scroll, custom scrollbar
- [x] Blackruby ruby-shaped logo + ruby/violet/indigo gradient brand palette
- [x] Build scripts for macOS universal + Windows x64
- [x] Release manifest generator producing the downloads page payload

## Domains / hosting

The marketing site is a plain Vite SPA — deploy `npm run -w @vinted-system/marketing build`
output (`marketing/dist`) to any static host (Vercel, Netlify, Cloudflare Pages, S3+CloudFront).
The API (`api/server.ts`) is a single Node/Express process — run it as a systemd unit or
behind PM2 on the same host that serves the static site (reverse-proxy `/api/*` to port 5181).

Installer downloads should be served from `https://blackruby.app/downloads/<version>/<file>`.
Either upload to your CDN before each release or proxy `/downloads/*` to a private S3 bucket
with signed URLs.
