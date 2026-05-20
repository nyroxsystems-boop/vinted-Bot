# Vinted-System

Vinted-only Verkaufs-Automation mit **CJ Dropshipping** als Fulfillment-Backend
und automatischem **Re-Listing nach jedem Sale**. React-Dashboard zur Steuerung.

> ⚠️ **Rechtlicher Hinweis**
>
> - Automatisierte Interaktion mit Vinted verstößt gegen deren AGB. Account-Sperren sind wahrscheinlich, nur eine Frage der Zeit.
> - Als Verkäufer bist du rechtlich Händler: Widerrufsrecht, Impressumspflicht, Gewährleistung, ggf. Umsatzsteuer. Kläre das vor Live-Betrieb.
> - Dropshipping zu Vinted-Käufern ist ein Graubereich. Käufer erwarten u. U. etwas anderes als sie bekommen — das Retouren-/Bewertungsrisiko ist hoch.
>
> Dieses Projekt ist ein technisches Werkzeug. Die Verantwortung für den Einsatz liegt beim Nutzer.

---

## Architektur (Vinted-only)

```
┌──────────┐   REST/SSE   ┌──────────────┐   HTTP   ┌─────────────────┐
│Dashboard │ ───────────▶ │ Orchestrator │ ───────▶ │ vinted-bot :4701│
│ (React)  │ ◀─────────── │  (Express)   │          └─────────────────┘
└──────────┘              │ + Scheduler  │
                          │ + Workers:   │   HTTP   ┌─────────────────┐
                          │   - auto-pub │ ───────▶ │ cj-service :4720│
                          │   - cj-fulf. │          │ → CJ API v2.0   │
                          │   - relister │          └─────────────────┘
                          │   - replier  │
                          │   - repricer │
                          │   SQLite     │
                          └──────────────┘
```

- **shared/** — geteilte Types, SQLite-Wrapper, Logger, Inventory-Locks.
- **vinted-bot/** :4701 — Playwright-Bot, pollt Inbox, erkennt Angebote/Sales, erstellt Listings.
- **cj-service/** :4720 — REST-Bridge zur CJ Dropshipping API v2.0.
- **orchestrator/** :4700 — Express + alle Worker + SSE-Live-Feed.
- **dashboard/** :5173 — React-UI.

**Pipeline:** `Listing → Offer → Accept → Sale → CJ-Order → Tracking → Re-Listing nach 24h`. Idempotent, crash-safe.

---

## Setup

Voraussetzungen: Node ≥ 20, npm ≥ 10.

```bash
cd system
npm install
npx playwright install chromium
cp .env.example .env
# .env editieren: CJ_EMAIL, CJ_PASSWORD (API Key, nicht Account-PW), ANTHROPIC_API_KEY
npm run db:migrate
```

### Einmaliges Login: Vinted

```bash
npm run vinted:login   # öffnet Browser headful, du loggst dich ein
```

Session landet in `vinted-bot/playwright-data/state.json`.

### CJ-API-Key besorgen

1. CJDropshipping Account anlegen (kostenlos)
2. Im Account → Setting → Open API
3. **App-Key** erzeugen — das ist dein `CJ_PASSWORD` in `.env` (Email = `CJ_EMAIL`)
4. **Daily-Quota:** Default 1000 Calls/Tag. Für mehr → Approval-Antrag (siehe FAQ)

---

## Start

**Variante A — Native Mac-App (empfohlen):**
```bash
npm run app:dev
```

**Variante B — Terminal:**
```bash
npm run dev           # orchestrator + vinted-bot + cj-service + dashboard
npm run dev:core      # synonym
```

Einzelne Services:
```bash
npm run dev:orchestrator  # :4700
npm run dev:vinted        # :4701
npm run dev:cj            # :4720
npm run dev:dashboard     # :5173
```

PM2 (Produktion auf Mac/Linux):
```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:status
```

Dashboard: **http://localhost:5173**

---

## Workflow (vollautomatisch nach Setup)

1. **Listings importieren / generieren** — auto_listings-Zeilen mit Fotos + CJ-URL füllen (Script oder Dashboard).
2. **CJ-Mapping aufbauen** — `node scripts/cj-resolve-mappings.mjs` füllt cj_product_id + cj_variant_id pro Folder.
3. **Approve** — Status der auto_listings von `draft` auf `approved`. Kann Bulk-SQL oder Dashboard.
4. **Auto-Publisher** schiebt 1 Listing/Min auf Vinted (gedeckelt durch `vinted_daily_publish_cap`).
5. **Käufer kauft** → vinted-bot detektiert Sale → schreibt `sales`-Row.
6. **Re-Lister** stempelt `auto_listings.sold_at` + setzt `inventory_locks.is_sold=1`.
7. **CJ-Fulfillment** sieht die paid Sale → bestellt bei CJ → schreibt `cj_orders`.
8. **24h nach Sale** clont der Re-Lister das Listing → `status='approved'` → Auto-Publisher schiebt es wieder live.
9. **Tracking** pollt der cj-fulfillment Worker alle 6h für ordered Orders (Cooldown), bei tracking-Number → Update `sales.tracking_number` → vinted-bot pusht es in den Chat.
10. **Delivery** wird alle 24h gepollt; nach `delivered` → Vinted-Auszahlung freigeschaltet.

**Daily-Caps eingebaut:**
- Vinted-Publish: 30 neue Listings / Account / Tag (`vinted_daily_publish_cap`)
- CJ-Orders: 50 / Tag (`cj_max_daily_orders`)
- Re-Lists: 30 / Tag (`relist_max_per_day`)

---

## Re-Listing-Mechanismus

Nach jedem Sale läuft folgender Lifecycle automatisch:

```
auto_listing X (status=published, sold_at=NULL)
   ↓ Verkauf wird erkannt
auto_listing X (status=published, sold_at=NOW)
inventory_locks.is_sold=1
listings.status=sold
   ↓ Re-Lister tickt alle 30 min
   ↓ Wartet bis sold_at + 24h vorbei
   ↓ Prüft daily-cap (30/Tag) + kein anderes aktives Sibling
   ↓ Klont row → INSERT INTO auto_listings(status='approved', parent_folder_num=X)
   ↓ Auto-Publisher schiebt es in <60s an Vinted
neuer auto_listing Y (status=published, parent_folder_num=X, relist_count=N+1)
```

**Settings:**
- `relist_enabled` (default `true`)
- `relist_delay_hours` (default `24`)
- `relist_max_per_day` (default `30`)
- `relist_inactive_pause_days` (default `21`) — pausiert Folder ohne Sale > 21d

**Pausieren/Forcieren via Dashboard-API:**
```bash
curl -X POST http://localhost:4700/api/relist/pause/{folder_num}
curl -X POST http://localhost:4700/api/relist/resume/{folder_num}
curl -X POST http://localhost:4700/api/relist/now/{folder_num}  # skip 24h delay
```

---

## CJ-Quota: was du wissen musst

CJ erlaubt standard **1000 Calls/Tag**. Pro Sale-Lifecycle verbraucht das System **~17 Calls** (1 Order + 2–4 Tracking-Polls + 10–14 Delivery-Polls). **→ ~50 Sales/Tag passen ins Limit.**

Polling läuft mit **Cooldowns**:
- Tracking: alle 6h pro Order
- Delivery: alle 24h pro Order

Bei `ordered` > 48h ohne Tracking → automatischer Telegram-Alert.

**Höheres Quota beantragen:** `developer@cjdropshipping.com` oder Website-Chat. CJ verlangt:
1. Integration-Demo-Video
2. Backend-Screenshot mit Storenamen
3. CJ-User-ID + verifizierter Email + WhatsApp
4. Business-Identity (Firma oder Personal-ID)

---

## Safety-Features

| Feature | Wo |
|---|---|
| Hard-Stop-Schalter | Dashboard → "System PAUSIEREN" |
| Vinted-Daily-Cap | `vinted_daily_publish_cap` (default 30) |
| CJ-Max-Order-€ | `cj_max_order_eur` (default 30) |
| CJ-Daily-Cap | `cj_max_daily_orders` (default 50) |
| Re-List-Daily-Cap | `relist_max_per_day` (default 30) |
| Re-List-Pause inaktive Folder | `relist_inactive_pause_days` (default 21) |
| Photo-Pre-Check vor Publish | Auto-Publisher prüft Files existieren |
| CAPTCHA-Detection | Auto-Publisher kategorisiert Fail-Reason, alerted |
| Idempotenz | `cj_orders.uniq_sale`, `inventory_locks.folder_num` PK |

---

## Operational Runbook

### Was tun bei "Listing failed (captcha)"?
1. Vinted-Account manuell öffnen, CAPTCHA lösen, einloggen.
2. `npm run vinted:login` (Session refresh).
3. Auto-Publisher pickt nächstes approved Listing automatisch.

### Was tun bei "Listing failed (auth)"?
```bash
npm run vinted:login
```

### Was tun bei "Listing failed (dom)"?
Vinted hat HTML geändert. Update `vinted-bot/src/listings/selectors.ts`:
```bash
npx playwright codegen https://www.vinted.de
```

### Was tun bei "CJ-Order seit 48h ohne Tracking"?
- CJ-Dashboard öffnen, Order suchen, manuell prüfen
- Häufig: out-of-stock, falsche Variant, oder Adresse abgelehnt
- Fix manuell, dann `cj_orders.stuck_alerted_at` zurücksetzen damit Alert nicht wiederkommt

### Daily-Cap erreicht?
- Vinted: zu schnell. Warten bis 24h um, `vinted_daily_publish_cap` evtl. erhöhen wenn Account "warm" ist
- CJ: Quota-Approval beantragen (siehe oben)
- Re-List: zu viele Sales an einem Tag — Worker queued, am nächsten Tag weiter

---

## Tests

```bash
node scripts/test-cj-cooldown.mjs   # CJ-Poll-Cooldown-Logik
node scripts/test-relister.mjs       # Re-Lister Detect/Stamp/Schedule
```

---

## Ordnerstruktur

```
system/
├── shared/                  # @vinted-system/shared (DB, Types, Logger, Locks)
├── vinted-bot/   :4701      # Playwright-Bot
├── cj-service/   :4720      # CJ API HTTP-Bridge
├── orchestrator/ :4700      # Workers + Routes + SSE
├── dashboard/    :5173      # React UI
├── scripts/                 # cj-resolve-mappings, test-*, fal/nano image gen
└── data/accounts/{id}/      # Vinted-Sessions pro Account
```

---

## Bekannte Einschränkungen

- **Kein CAPTCHA-Solving**: Bot pausiert + alerted, du löst manuell.
- **Ein Vinted-Account pro Installation** (Multi-Account nicht produktiv getestet).
- **Adress-Parser** für Vinted-Käufer ist Best-Effort; exotische Formate müssen manuell als JSON in `sales.buyer_address` gepflegt werden.
- **Rechtliche Pflichten** (Impressum, Widerruf, Steuer) sind nicht Teil dieses Systems — extern regeln.
- **Vinted-Listings = 30/Tag** Soft-Cap. Höher → Account-Flag-Risiko.
