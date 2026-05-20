# Multi-Tenant Readiness Roadmap

**Stand:** 2026-05-12 · **Ziel:** System verkaufsfähig machen — d.h. ein neuer Nutzer kann es auf seinem Mac installieren und ohne Code-Änderungen mit seinen eigenen Accounts, Ordnern, Zahlungsdaten benutzen.

## TL;DR

Das System ist **per-Account-DB-mäßig schon sauber strukturiert** (alle Hauptobjekte haben `account_id FK`, Browser-Profile sind isoliert via `accountDir()`). Aber drei Klassen von Hard-Codings blockieren den Verkauf:

1. **Hardcoded Pfade** auf `/Users/home/Vinted` (~10 Files).
2. **Globale Settings** in der `settings`-Tabelle, die per-Account sein sollten (PayPal, IBAN, eBay-OAuth, CJ-Account, Versand-Adresse).
3. **Externe Services** (CJ, eBay, Etsy, Captcha-Solver) lesen Credentials beim Modul-Load aus `process.env` → ein Prozess = ein Mandant.

## Blockers (vor Verkauf zwingend fixen)

### 1. Pfad-Hardcodings auf `/Users/home/Vinted`

Diese Dateien fallen back auf den Owner-Pfad, wenn `VINTED_ROOT` nicht gesetzt ist:

- `orchestrator/src/marketplaces.ts:27`
- `orchestrator/src/ebay-api.ts:412`
- `orchestrator/src/etsy-api.ts:346`
- `orchestrator/src/listing-generator.ts:18`
- `orchestrator/src/routes/products.ts:31` + `:197`
- `orchestrator/src/routes/ai.ts:34`
- `orchestrator/src/db-backup.ts:34`
- `antigravity-mcp/src/index.ts:33`
- `shared/src/schema.sql:29-35` (Seed)

**Scripts mit hardcoded Pfaden**:
- `orchestrator/src/scripts/import-vinted-folder.ts:23-25` (`VINTED_ROOT`, `LINKS_FILE`, `ACCOUNT_ID = 1`)
- `orchestrator/src/scripts/generate-listings-doc.ts:10-14`

**Fix**: Ersetze alle Hardcodings durch `resolveRepoRoot()` (existiert schon in `db.ts:90`). Mache `VINTED_ROOT` required oder default auf Repo-Root, nicht auf $HOME.

### 2. Globale Settings → per-Account

Diese Settings in `settings` müssen per-Account sein:

- `seller_name`, `seller_display_name`, `seller_zip`, `seller_city`
- `payment_methods_json`
- `shipping_default_provider`
- `cj_email`, `cj_api_key`, `cj_password`
- `ebay_client_id`, `ebay_client_secret`, `ebay_refresh_token`
- `etsy_*`, `shopify_*`, `wc_*`
- `telegram_chat_id`
- `captcha_api_key`

**Fix-Vorschlag**: Neue Tabelle
```sql
CREATE TABLE IF NOT EXISTS account_settings (
  account_id INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (account_id, key)
);
```
Mit Helper `getAccountSetting(accountId, key)` / `setAccountSetting(accountId, key, value)`. Migration kopiert bestehende globale Settings auf alle aktiven Accounts.

### 3. Externe Services pro Aufruf re-initialisieren

Heute liest jeder Service-Module einmalig `process.env`:
- `cj-service/src/index.ts:33-40`
- `etsy-api.ts:27-30`
- `shopify-api.ts:16-17`
- `woocommerce-api.ts:17-19`
- `shared/src/marketplace/captcha.ts:39`
- `shared/src/llm.ts:139/171`

**Fix**: Factory-Pattern. Statt `const cjClient = new CjClient(process.env.CJ_*)` global, übergebe `accountId` an jeden Call und resolve Creds via `getAccountSetting(accountId, 'cj_email')`.

### 4. Sekrete im Repo

`.env` enthält LIVE-Credentials (`CJ_EMAIL=blackruby.de@gmail.com`, `ANTHROPIC_API_KEY=...`, `FAL_KEY`, `GEMINI_API_KEY`).

**Fix**: `.env` aus dem Repo entfernen (in `.gitignore`, already), `.env.example` mit Platzhaltern committen, Setup-Dok in README.

### 5. Hardcoded `account_id: 1` in Routes

- `orchestrator/src/routes/crosslist.ts:23`
- `orchestrator/src/routes/kleinanzeigen.ts:89`
- `orchestrator/src/auto-publisher.ts:191`
- `dashboard/src/pages/Marketplace.tsx:214`

**Fix**: Aktuelle Account-ID aus Session/Auth-Layer holen (siehe Punkt 7).

### 6. Dashboard-Origin hardcoded

`dashboard/src/api/base.ts:17`: `ORCHESTRATOR_ORIGIN = 'http://localhost:4700'` ist im Build eingebrannt.

**Fix**: Build-Zeit-Variable über `VITE_ORCHESTRATOR_URL`, Runtime via `window.__VINTED_API__` fallback.

### 7. Kein Auth-Layer

Der Orchestrator (Port 4700) ist offen — wer immer localhost erreicht, kann alles steuern. Bei Verkauf an externe Nutzer muss mindestens lokales Token-Auth rein.

**Fix**: Express-Middleware mit `X-API-Token`-Check, Token in DB-Settings, beim ersten Start generiert.

## Soft Issues (UX-Probleme für neuen Nutzer)

- **Sprache**: Alle Seed-Strings, Defaults und Templates sind Deutsch. UI ist Deutsch.
  → Sprach-Toggle für DE/EN/FR/IT/ES.
- **Kategorien**: `CATEGORY_MAP` in `variant-generator.ts:50-94` und `llm-listing-generator.ts:26-29` hat nur Damen-Mode (Kleider/Hotpants/Jumpsuits). Männer-Sneaker-Verkäufer hat null Optionen.
  → DB-gestützte per-Account Kategorien-Konfiguration.
- **Vinted-Domain**: `VINTED_BASE_URL` defaults `vinted.de`. UK/FR/IT-Nutzer brauchen per-Account override.
- **Browser-Profile-Speicher**: Funktioniert schon (`accountDir()`), aber Erstanmeldung erfordert manuelles Klicken — kein Wizard.

## Bereits multi-tenant-tauglich

- `shared/src/accounts.ts` — saubere CRUD, `VINTED_DATA_ROOT` Override, per-Account FS-Layout
- Schema: alle Haupt-Tabellen haben `account_id FK ON DELETE CASCADE`
- `shared/src/browser.ts` + `kleinanzeigen-bot/src/browser.ts` — Per-Account `userDataDir` aus `storageDir`
- Worker (cj-fulfillment, repricer, cross-sync, relister, auto-publisher) sind account-aware
- `accountLabelsDir()` statt `_labels/`-Singleton

## Roadmap (5 Schritte, geordnet)

### Schritt 1: Pfad-Sanierung (1-2h)
- Ersetze alle `/Users/home/Vinted`-Hardcodings durch `resolveRepoRoot()` (siehe db.ts:90).
- Strip `.env`, schreibe `.env.example`.
- Verifikation: `grep -r "/Users/home/Vinted" system/` liefert NUR Kommentare oder Test-Dateien.

### Schritt 2: `account_settings`-Tabelle (3-4h)
- Schema + Migration.
- `getAccountSetting(accountId, key)` / `setAccountSetting(accountId, key, value)` Helper in shared/src/db.ts.
- Bestehende Settings (Liste oben) auf neue Tabelle migrieren mit Default-Fallback.
- Settings-Page UI: pro Account-Tab.

### Schritt 3: External-Service-Refactor (4-6h)
- CJ-Client, eBay-OAuth, Etsy, Shopify, Woo, Captcha: factory(`accountId`) → instance.
- Worker-Loops übergeben `accountId` an jeden Call.
- LLM bleibt evtl. global (Claude-CLI ist sowieso lokal) oder per-Account-Key.

### Schritt 4: Auth + UI-Wizard (4-6h)
- Express-Middleware mit Token-Header.
- Dashboard: First-Run-Wizard (Account anlegen → Vinted-Login → KA-Login → CJ-Setup → PayPal/IBAN eintragen → fertig).
- Token im DB-Setting, beim Bootstrap generiert, UI zeigt es einmal an.

### Schritt 5: i18n + Kategorien-Pluralismus (1-2 Tage)
- React-i18n Setup, alle deutschen Strings in `de.json`.
- Englische Translation.
- Kategorien aus DB-Tabelle `account_categories` laden statt aus Hardcoded `CATEGORY_MAP`.
- Vinted-Domain pro Account konfigurierbar.

**Geschätzter Gesamtaufwand bis Verkaufs-Reife: 3-5 Tage Fokus-Arbeit.**

## Bonus (nice-to-have nach Verkaufs-Reife)

- Docker-Image (Orchestrator + Dashboard + cj-service in einem Compose).
- Auto-Update-Mechanismus (z.B. via GitHub Releases).
- Telemetry/Crash-Reporting (opt-in).
- Per-Tenant Backup-Strategie (S3 oder iCloud).
- Mandanten-übergreifender Admin-Dashboard für Support.
