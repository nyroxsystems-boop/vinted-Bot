# Brutaler Audit — Vinted-System
_Stand: 2026-04-29 nach Multi-Marketplace-Bauwelle_

## Production-Kill-Punkte (vor Live-Verkauf zwingend)

| # | Punkt | Severity | Wo | Status |
|---|-------|----------|-----|--------|
| 1 | Vinted-Selektoren nie gegen Live-UI verifiziert | 🔴 | [vinted-bot/src/selectors.ts](vinted-bot/src/selectors.ts) | offen |
| 2 | Kein Captcha-Solver (jetzt Hub mit 2Captcha/CapMonster — API_KEY fehlt) | 🔴 | [shared/src/marketplace/captcha.ts](shared/src/marketplace/captcha.ts) | Hook ✅, Key ❌ |
| 3 | Browser-Fingerprint war fix; jetzt deterministisch pro Account | 🟢 | [shared/src/marketplace/fingerprint.ts](shared/src/marketplace/fingerprint.ts) | erledigt |
| 4 | Kein Proxy-Pool — Multi-Account = Insta-Ban | 🔴 | DB-Spalte `vinted_accounts.proxy_url` da, kein Proxy-Provider | Schema ✅, Setup ❌ |
| 5 | Cookies plaintext auf Disk | 🟡 | [shared/src/browser.ts:39](shared/src/browser.ts) | by design (lokal) |
| 6 | Null Tests | 🔴 | gesamt | offen |
| 7 | Kein Cross-Platform Sale-Sync | 🟢 | [shared/src/inventory-lock.ts](shared/src/inventory-lock.ts) | erledigt |
| 8 | Kein Performance-Tracking | 🟡 | DB-Tabelle `listing_metrics` da, kein Collector | Schema ✅ |
| 9 | Keine Bulk-Actions | 🟢 | [orchestrator POST /api/products/bulk](orchestrator/src/routes/products.ts) | erledigt |
| 10 | Kleinanzeigen/Mercari/Depop nicht existent | 🟢 | jetzt Workspaces da | KA: 70%, Mercari/Depop: 30% |

## Was diese Session gebaut hat

### Foundation (`shared/src/marketplace/`)
- **types.ts** — `MarketplaceAdapter` Interface (publish/deactivate/updatePrice/handleOffer), `ListingDraft`, `MarketplaceId` enum (vinted, kleinanzeigen, mercari, depop, wallapop)
- **selector-chain.ts** — multistage Selektoren mit Auto-Diagnose (Screenshot+DOM+JSON nach `_diag/` bei Drift)
- **retry.ts** — Exp-Backoff + Jitter, `abortIf` für non-retry-fähige Errors (Captcha)
- **fingerprint.ts** — deterministischer Per-Account-Fingerprint (UA/Viewport/Timezone/Locale/HW/WebGL aus accountId+marketplace seed)
- **category-map.ts** — Vinted ↔ Kleinanzeigen/Mercari/Depop/Wallapop Kategorie-Tables
- **captcha.ts** — Pluggable-Solver mit 2Captcha + CapMonster Adapter, Manuel-Fallback
- **inventory-lock.ts** — Cross-Platform-Lock: 1 Folder verkauft → andere Listings auto-gesperrt

### Schema-Erweiterung ([shared/src/schema.sql](shared/src/schema.sql))
- `marketplace_listings` — pro Plattform-Listing (external_id, status, views/likes/messages)
- `inventory_locks` — physisches Item gesperrt nach Sale
- `listing_metrics` — Tagesschnappschüsse pro Listing
- `vinted_accounts.proxy_url`, `vinted_accounts.marketplace` (via ensureColumn)

### Neue Workspaces
| Workspace | Port | Stand |
|-----------|------|-------|
| **kleinanzeigen-bot** | 4703 | Login ✅, Publish ✅, Deactivate ✅, Adapter ✅ — Selektoren UNVERIFIED |
| **mercari-bot**       | 4704 | Login ✅, Publish ❌ Stub, Selektoren skizziert |
| **depop-bot**         | 4705 | Login ✅, Publish ❌ Stub, Selektoren skizziert |

### Orchestrator-API
- `POST /api/products/:folderNum/push-multi` — parallel auf N Plattformen pushen
- `GET /api/products/:folderNum/marketplace-listings` — Status pro Plattform
- `GET /api/products/marketplaces/health` — Bot-Liveness
- `POST /api/products/sold` — Sale melden, Cross-Deactivate triggern
- `POST /api/products/bulk` — Massen-`push-multi`, `pause`, `resume`, `price-change`

### Dashboard (`ProductDetail.tsx`)
- Neuer Block "Marktplätze" mit:
  - 5 Plattform-Karten (Vinted, Kleinanzeigen, Mercari, Depop, Wallapop)
  - Live-Health-Indikator (grün/rot Punkt = Bot online)
  - Pro-Plattform Status (active/sold/failed/draft + views/likes/Preis/Fehler)
  - Multi-Select + großer "Auf N Plattformen pushen"-Button
  - Auto-Save vor Push, Push-Result-Toast

## Verbleibende Hausaufgaben (priorisiert)

### Sofort (vor erster Live-Aktion)
1. **`npm install`** im Root — neue Workspaces verlinken
2. **`npm run db:migrate`** — neue Tabellen anlegen
3. **Kleinanzeigen-Selektoren verifizieren** — `npm run kleinanzeigen:login`, dann manuell ein Listing erstellen + DevTools-Inspect, in `kleinanzeigen-bot/src/selectors.ts` Selektoren anpassen
4. **Captcha-API-Key** in `.env`: `CAPTCHA_PROVIDER=2captcha` und `CAPTCHA_API_KEY=...`

### Nächste 2 Sessions
5. Mercari/Depop Publish-Flow ausbauen (Selektoren bereits da, fehlt nur create.ts)
6. Vinted-Bot auf MarketplaceAdapter-Interface refactoren (damit auch Vinted aus push-multi rausgepusht wird)
7. Performance-Collector: täglicher Cron, der pro Listing views/likes von der Plattform pullt → `listing_metrics`
8. Proxy-Pool-Konfiguration: pro Account ein Wohnsitz-Proxy (BrightData/IPRoyal)
9. Tests: Vitest für Foundation + ein Smoke-Test pro Adapter

### Mittelfristig
10. Selector-Self-Test pro Bot (`npm run X:selftest`) — loggt ein, prüft kritische Selektoren, schreibt Report
11. Listing-Performance-Auswertung im Dashboard (welcher Titel/Preis/Foto-Reihenfolge konvertiert)
12. A/B-Title-Engine — 2 Titel parallel pro Item, automatische Gewinnerauswahl
13. Preis-Drop-Strategie — nach X Tagen ohne Offer, -10% pro Plattform bis Floor
14. Antwort-Autopilot via Claude für Käuferfragen

## Wie das jetzt aussieht (Architektur)

```
                    ┌────────────────────────┐
                    │    Dashboard :5173    │
                    │  (Marktplatz-UI)      │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   Orchestrator :4700   │
                    │  /push-multi /bulk    │
                    │  /sold (Cross-Sync)   │
                    └───────────┬────────────┘
                                │
        ┌──────────┬───────────┼───────────┬──────────┐
        ▼          ▼           ▼           ▼          ▼
   vinted-bot  klein.-bot  mercari-bot  depop-bot  temu-bot
     :4701       :4703       :4704       :4705      :4702
        │          │           │           │          │
        └──────────┴── shared/marketplace/* ──────────┘
              (Adapter, Fingerprint, Selector-Chain,
               Retry, Captcha, Category-Map, Inventory-Lock)
```

## Getestet / Nicht getestet

| Was | Test-Stand |
|-----|------------|
| TypeScript-Build aller 9 Workspaces | ✅ alle clean |
| Kleinanzeigen-Selektoren | ❌ educated guess |
| Multi-Push gegen echte Plattformen | ❌ ungetestet |
| Captcha-Hub gegen echtes 2Captcha | ❌ ungetestet (Code ist standard-konform) |
| Inventory-Lock SQL-Transaktion | ❌ keine Tests |
| Dashboard-UI Browser-rendered | ❌ nicht aufgemacht |
| Cross-Platform-Deactivate-Flow | ❌ Endpunkte da, nicht durchlaufen |
