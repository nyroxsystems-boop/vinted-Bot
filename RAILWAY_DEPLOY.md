# Deploy blackruby.de on Railway

Goal: marketing-Site + marketing-API live unter `https://blackruby.de`, mit deinem Stripe-Account, in einem Railway-Service.

**Geschätzter Aufwand**: 15 Minuten Klicken, danach automatische Deploys bei jedem `git push`.

---

## 0. Voraussetzungen

- ✅ Railway-Account (https://railway.app — login via GitHub, kostenlos für Start)
- ✅ blackruby.de Domain bei deinem Registrar (Strato/Namecheap/etc.)
- ✅ Stripe-Account mit Live-API-Keys
- ✅ Das GitHub-Repo `nyroxsystems-boop/vinted-Bot` (haben wir schon)

---

## 1. Railway-Service anlegen (3 Minuten)

1. https://railway.app/dashboard → **New Project** → **Deploy from GitHub repo**
2. Pick `nyroxsystems-boop/vinted-Bot`
3. Railway erstellt automatisch einen Service. **Settings** öffnen:
   - **Root Directory**: `marketing`
   - **Build Command**: leer lassen (nixpacks.toml im marketing/-Ordner übernimmt das)
   - **Start Command**: leer lassen (nixpacks.toml setzt das)
4. **Add Volume** (für die SQLite-DB, sonst sind License-Keys nach jedem Deploy weg):
   - Settings → Volumes → New Volume
   - Mount Path: `/app/marketing/data`
   - Size: 1 GB reicht (Railway-Free-Tier limitiert)

## 2. Environment Variables (5 Minuten)

Railway → Service → **Variables** → diese setzen:

```bash
NODE_ENV=production
PUBLIC_URL=https://blackruby.de

# Stripe — aus deinem Stripe-Dashboard (Developer → API Keys)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...      # erst nach Webhook-Setup (Schritt 4)

# Price IDs — aus Stripe-Dashboard (Produkte → dein Produkt → Price IDs kopieren)
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_STARTER_YEARLY=price_...
STRIPE_PRICE_HUSTLER_MONTHLY=price_...
STRIPE_PRICE_HUSTLER_YEARLY=price_...
STRIPE_PRICE_LIFETIME=price_...

# License-Signing-Secret (selbst generieren mit einem zufälligen 64-Hex-Wert):
LICENSE_SIGNING_SECRET=<openssl rand -hex 32>
```

**LICENSE_SIGNING_SECRET generieren** (im Terminal auf deinem Mac):
```bash
openssl rand -hex 32
# Output kopieren → in Railway-Variables einfügen
# Den gleichen Wert nimmst du SPÄTER auch als VITE_LICENSE_VERIFY_KEY in GitHub-Secrets (für customer builds).
```

## 3. Custom-Domain blackruby.de verbinden (5 Minuten)

1. Railway → Service → **Settings** → **Networking** → **Custom Domain** → `blackruby.de`
2. Railway zeigt dir einen CNAME-Wert wie `mainline-production-xxxx.up.railway.app`
3. Bei deinem Domain-Registrar (Strato etc.):
   - **A-Record** für `blackruby.de` → Railway-IP (siehst du im Railway-Dashboard)
   - ODER **CNAME** für `www.blackruby.de` → der angezeigte railway-URL
4. ~10 Min DNS-Propagation warten, dann zeigt Railway grünes ✓ Symbol
5. Railway provisioniert automatisch Let's-Encrypt-SSL — Site läuft unter `https://blackruby.de`

## 4. Stripe-Webhook einrichten (3 Minuten)

Damit Stripe Lizenzen ausstellt nach Bezahlung:

1. Stripe-Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. **Endpoint URL**: `https://blackruby.de/api/stripe/webhook`
3. **Events to send**: 
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
4. **Signing secret** kopieren (whsec_...)
5. Zurück zu Railway → Variables → `STRIPE_WEBHOOK_SECRET` mit dem Wert befüllen
6. Railway redeployt automatisch (~30s)

## 5. Customer-Build mit License-Validation verbinden

Sobald blackruby.de live ist, willst du dass die Tauri-App License-Keys VALIDIERT (statt nur bypass):

1. **GitHub Repo Settings** → **Secrets and variables** → **Actions** → **New secret**:
   - Name: `LICENSE_VERIFY_KEY`
   - Value: `<derselbe Wert wie LICENSE_SIGNING_SECRET in Railway>`
2. **`.github/workflows/ci.yml`** öffnen, im `Build dashboard`-Step diese Zeile löschen:
   ```yaml
   VITE_BYPASS_LICENSE: 'true'
   ```
3. Tag neuen Release: `git tag v0.8.0 && git push origin v0.8.0`
4. Ab jetzt fordert die App beim Erststart einen License-Key, validiert ihn gegen `https://blackruby.de/api/license/validate`.

---

## Was Customer dann erlebt

1. Besucht `https://blackruby.de` → Marketing-Site mit Pricing
2. Klickt "Kaufen" → Stripe Checkout (echtes Geld)
3. Nach Zahlung: Stripe-Webhook generiert License-Key, sendet E-Mail
4. Customer öffnet die installierte Blackruby-App → License-Gate fragt nach Key
5. Key eingeben → App validiert gegen blackruby.de → unlocked

## Wenn was schief geht

| Symptom | Wo nachsehen |
|---|---|
| Site lädt nicht | Railway → Service → **Deployments** → letztes Deploy → Logs |
| Stripe-Webhook failed | Stripe-Dashboard → Webhooks → dein Endpoint → "Recent deliveries" |
| License-Validation 500 | Railway Logs filtern auf `[license]` |
| DNS-Propagation | `dig blackruby.de` im Terminal, oder https://dnschecker.org |

## Auto-Deploys

Railway watcht den main-Branch. Jeder `git push origin main` deployt automatisch innerhalb 1-2 Min. Wenn du nicht willst dass jeder commit live geht, in Railway Settings → Service → "Branch" auf z.B. `release` umstellen.
