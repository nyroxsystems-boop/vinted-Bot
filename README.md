# Vinted-System

Privates Automations-Monorepo mit zwei Playwright-Bots (Vinted-Chat-Management, Temu-Auto-Bestellung) und einem React-Dashboard zur Steuerung.

> ⚠️ **Rechtlicher Hinweis**
>
> - Automatisierte Interaktion mit Vinted und Temu verstößt gegen deren AGB. Account-Sperren sind wahrscheinlich, nur eine Frage der Zeit.
> - Als Verkäufer bist du rechtlich Händler: Widerrufsrecht, Impressumspflicht, Gewährleistung, ggf. Umsatzsteuer. Kläre das vor Live-Betrieb.
> - Dropshipping von Temu zu Vinted-Käufern ist ein Graubereich. Käufer erwarten u. U. etwas anderes als sie bekommen — das Retouren-/Bewertungsrisiko ist hoch.
>
> Dieses Projekt ist ein technisches Werkzeug. Die Verantwortung für den Einsatz liegt beim Nutzer.

---

## Architektur

```
┌──────────┐   REST/SSE   ┌──────────────┐   HTTP   ┌────────────┐
│Dashboard │ ───────────▶ │ Orchestrator │ ───────▶ │ vinted-bot │
│ (React)  │ ◀─────────── │  (Express)   │          │ (Playwright)│
└──────────┘              │ + Scheduler  │          └────────────┘
                          │ + Pipeline   │          ┌────────────┐
                          │   SQLite     │ ───────▶ │  temu-bot  │
                          └──────────────┘          │ (Playwright)│
                                                    └────────────┘
```

- **shared/** — geteilte Types, SQLite-Wrapper, Logger, Queue, Playwright-Helper, Offer-Regeln.
- **vinted-bot/** — pollt Inbox, erkennt Angebote, klickt Accept/Decline (HTTP-API auf `:4701`).
- **temu-bot/** — bestellt bei Temu auf Käuferadresse, trackt Status (`:4702`).
- **orchestrator/** — Express-Server `:4700` + Scheduler + State-Machine + SSE-Live-Feed.
- **dashboard/** — React-UI `:5173`, konsumiert `/api` und `/stream`.

Die Pipeline: **Offer erkannt → evaluate → Accept → Sale → Temu-Order → Tracking**. Jeder Schritt ist idempotent und persistiert, sodass ein Crash die Pipeline am letzten Zustand wieder aufnimmt.

---

## Setup

Voraussetzungen: Node ≥ 20, npm ≥ 10.

```bash
cd Vinted-System

# 1. Dependencies + Chromium installieren (dauert 1-2 min)
npm install
npx playwright install chromium

# 2. .env anlegen aus Vorlage
cp .env.example .env
# ...dann .env editieren (optional: VINTED_EMAIL, TEMU_EMAIL, Port-Änderungen)

# 3. Datenbank migrieren
npm run db:migrate
```

### Einmalig: Login in beiden Shops

Die Bots loggen sich **nicht automatisch** ein. Du öffnest einmal den Browser manuell, loggst dich ein (inkl. 2FA und — bei Temu — der Zahlungsmethode), und die Session wird gespeichert. Danach nutzen die Bots die gespeicherte Session.

```bash
npm run vinted:login   # öffnet Vinted, du meldest dich an
npm run temu:login     # öffnet Temu, du meldest dich an + fügst Zahlungsmethode hinzu
```

Sessions landen in:
- `vinted-bot/playwright-data/state.json`
- `temu-bot/playwright-data/state.json`

---

## Start

Alle 4 Services auf einmal (Orchestrator + Bots + Dashboard):

```bash
npm run dev
```

Einzeln:

```bash
npm run dev:orchestrator    # :4700
npm run dev:vinted          # :4701
npm run dev:temu            # :4702
npm run dev:dashboard       # :5173
```

Dashboard: **http://localhost:5173**

---

## Geschäftsmodell (Batch-Cart + Re-Shipping)

Das System nutzt ein **Batch-Cart-Modell** in Kombination mit Re-Shipping:

1. Vinted-Käufer kauft → bezahlt → Vinted generiert automatisch ein Versandetikett
2. System sammelt alle verkauften Artikel über ein Zeitfenster (z. B. 24h, 48h, 7 Tage)
3. **Du klickst im Dashboard „Batch erstellen"** → Bot öffnet Temu, geht zu jedem Produkt, wählt die Größe, klickt „In den Warenkorb"
4. **Du klickst „Zu Temu-Warenkorb"** → Temu öffnet sich mit vollem Warenkorb → du bezahlst **einmal** für alle Items
5. Temu liefert ALLE Pakete gesammelt an DICH (eine Lieferung, spart Versandkosten)
6. Du klebst pro Paket das Vinted-Label drauf, gibst alles bei Hermes/DHL ab

**Vorteile gegenüber Auto-Order:**
- Volle Kontrolle: du siehst den ganzen Warenkorb vor dem Bezahlen
- Keine Bot-Automation beim Bezahlen → viel sicherer (keine 3DS/Captcha-Probleme)
- Eine Temu-Bestellung statt viele → weniger Versand, Rabatt-Schwellen leichter erreichbar
- Skaliert: 1 Verkauf oder 20 — dasselbe Procedere

## Workflow

1. **Listings anlegen** (Dashboard → *Listings*)
   - Vinted-URL, Titel, Listpreis, Mindestpreis (Auto-Accept-Schwelle)
   - **Temu-URL inkl. `?spec_id=...`** (Farbe in der URL — einmal auf Temu auswählen und URL kopieren)
   - Variante als JSON `{"size":"M"}` (nur Größe — Farbe steckt in der URL)
   - Dry-Run für Beobachtungs-Modus
2. **Bot läuft automatisch**: pollt Inbox alle 60 s, akzeptiert Angebote ≥ min_accept_price
3. **Verkauft wird autonom** — aber es wird NICHT automatisch bei Temu bestellt
4. **Du entscheidest, wann du den Temu-Teil startest:**
   - Dashboard → *Fulfillment*
   - Zeitfenster wählen: `12h`, `24h`, `48h`, `3T`, `7T`
   - Siehst alle bezahlten Verkäufe im Fenster
   - Klick *„Batch erstellen"* → erzeugt einen Batch
   - Klick *„In Warenkorb legen"* → Bot legt alle Items bei Temu in den Cart
   - Klick *„Zu Temu-Warenkorb"* → öffnet Temu in deinem Browser mit vollem Cart
   - Du bezahlst wie gewohnt, klickst „Als bezahlt markieren" im Dashboard
5. **Tracking + Weiterversand**: Dashboard *Verkäufe* zeigt Status pro Sale

## Analytics

Dashboard → *Analytics* zeigt dir:
- **Umsatz pro Tag** (Area-Chart, 7/14/30/90 Tage)
- **Angebote pro Tag** (eingegangen / akzeptiert / bezahlt als Bar-Chart)
- **Conversion-Funnel**: Offers → Accepted → Paid → Erfüllt (mit %-Raten)
- **Bestseller-Ranking**: Top 10 Listings nach Verkaufszahlen

## Dashboard-Struktur

Professionelles Sidebar-Layout mit folgenden Bereichen:
- **Übersicht** — KPIs, 14-Tage-Umsatz-Chart, Bot-Status
- **Fulfillment** — Batch-Cart-Workflow (das Kernstück)
- **Listings** — Vinted ↔ Temu Mapping pflegen
- **Angebote** — Review-Queue für nicht-auto-akzeptierte Offers
- **Chats** — Live-Chat-Viewer, Angebote erkennen
- **Analytics** — Charts, Bestseller, Funnel
- **Live-Logs** — SSE-Event-Stream vom Orchestrator
- **Einstellungen** — Pause-Switch, Poll-Intervalle, Temu-Zahlungsmethode, Batch-Fenster

## Voraussetzungen in Temu (einmalig einrichten)

Bevor du den Bot startest, musst du in deinem Temu-Account manuell:
- Eine **Lieferadresse** hinterlegen (deine Heimatadresse) und als Default setzen
- Eine **Zahlungsmethode** konfigurieren — siehe nächster Abschnitt

Der Bot gibt **niemals** Kartendaten oder Adressen selbst ein.

## Zahlungsmethoden (wichtig!)

Temu hat **keine „Default-Zahlung"**-Funktion — der Bot muss bei jedem Checkout aktiv eine auswählen. Im Dashboard unter *Einstellungen → Temu-Zahlungsmethode* wählst du einmal global:

| Methode | Bot-tauglich? | Setup | Anmerkung |
|---|---|---|---|
| **PayPal** ✅ (empfohlen) | Ja | einmal in PayPal eingeloggt sein → Session-Cookie bleibt | Läuft am stabilsten. Nach 2–4 Wochen neu einloggen. |
| **Bezahlen Nach 30 Tagen** ✅ | Ja | einmal durchklicken, Geburtsdatum bestätigen | Klarna-basiert. Nach dem ersten Mal zinsfreie 30 Tage BNPL. |
| **Rechnung** ✅ | Ja | einmal Geburtsdatum bestätigen | Auch Klarna-basiert. |
| **Karte** ⚠️ | Nur bedingt | Karte im Temu-Konto hinterlegt | Wenn Bank 3DS triggert → Bot pausiert, SMS-Code nötig. |
| Apple Pay ❌ | Nein | — | Touch-ID / Face-ID auf Gerät nötig. |
| Google Pay ❌ | Nein | — | Gleich wie Apple Pay. |
| Sofort bezahlen ❌ | Nein | — | Bank-Login + TAN nötig. |
| Pay By Bank ❌ | Nein | — | Bank-Login nötig. |

**Erstes Setup (einmalig):**
```bash
npm run temu:login
```
öffnet den Browser headful. Du loggst dich bei Temu ein UND klickst einmal durch die Zahlungsmethode deiner Wahl (z. B. PayPal-Login), damit die Session-Cookies gespeichert werden. Danach läuft alles automatisch.

**Wenn die Session stirbt:** Der Bot erkennt PayPal-Login-Screens und andere Auth-Prompts und bricht die Bestellung ab mit einer klaren Fehlermeldung im Dashboard. Du machst dann einfach erneut `npm run temu:login` — fertig.

---

## Safety-Features

| Feature | Wo |
|---|---|
| Hard-Stop-Schalter | Dashboard → Übersicht → „System PAUSIEREN" |
| Max. € pro Temu-Order | `settings.temu_max_order_eur` (Default 50 €) |
| Max. Temu-Orders/24h | `settings.temu_max_daily_orders` (Default 10) |
| Dry-Run je Listing | Listing-Editor → Checkbox |
| Circuit-Breaker | 5 Fehler → 5 min Pause (Vinted), 3 → 10 min (Temu) |
| Captcha-Detection | Bot pausiert Job, sendet Alert via SSE |
| Idempotenz-Key | `sale-<id>` verhindert Doppelbestellungen |
| Keine Kartendaten | Temu-Bot nutzt NUR vorher gespeicherte Zahlungsmethode |

---

## Verifikation (End-to-End)

1. `npm install && npm run db:migrate` — keine Fehler.
2. `npm run vinted:login` öffnet Browser, Login-Flow funktioniert, `state.json` entsteht.
3. `npm run dev` startet alle 4 Services — Dashboard erreichbar.
4. Listing mit `dry_run=true` anlegen → erscheint in Übersicht-KPIs.
5. `settings.paused=true` setzen → Scheduler überspringt Zyklen (Logs).
6. Realer Test mit 1 günstigem Artikel (< 5 €, `TEMU_MAX_ORDER_EUR=5` in `.env`): Vollzyklus von Offer → Accept → Temu-Order verifizieren.
7. Bot-Prozess killen, neu starten → Pipeline setzt am letzten DB-State fort.
8. Temu-URL absichtlich falsch setzen → nach 3 Fails Circuit-Breaker, Alert im Dashboard.

---

## Selektor-Wartung

Vinted und Temu ändern ihr DOM regelmäßig. Wenn ein Bot bricht, prüfe zuerst:

- `vinted-bot/src/selectors.ts`
- `temu-bot/src/selectors.ts`

### Was verifiziert ist (Stand April 2026)

**Vinted:**
- Next.js App Router + React Server Components → initial HTML ist nur Skelett
- Design-System-Prefix: `web_ui__*` (z.B. `web_ui__Text__text`, `web_ui__Cell__cell`)
- Artikel-Karten: `.new-item-box__container`
- Artikel-URL: `/items/{id}-{slug}`

**Temu:**
- Initiales HTML ist obfuskiertes JS (lädt alles von `static.kwcdn.com`)
- Aggressives Anti-Scraping — Selektoren ändern sich häufig

### Was unverified ist

Alle Selektoren für **eingeloggte Bereiche** (Inbox, Konversation, Offer-Karte, Accept-Button, Temu-Checkout) sind Templates mit Fallback-Ketten, aber nicht gegen die Live-UI mit Login getestet. Vor Live-Betrieb musst du sie verifizieren.

### Selektoren live aktualisieren (Playwright Codegen)

```bash
# Für Vinted:
npx playwright codegen https://www.vinted.de
#  → im geöffneten Browser einloggen, zur Inbox gehen, einen Chat öffnen,
#    Angebot anklicken etc. Playwright-Inspector zeigt rechts für jede
#    Aktion den vorgeschlagenen Selektor an.
#  → In selectors.ts als ersten Eintrag der Fallback-Kette einfügen.

# Für Temu:
npx playwright codegen https://www.temu.com
#  → dto.
```

Fallback-Strategie in den Selektor-Dateien: Komma-separierte Kette, `data-testid` zuerst, dann semantische Attribute, dann Text-Matcher. Playwright's `locator()` nimmt den ersten Treffer.

---

## Ordnerstruktur

```
Vinted-System/
├── package.json            # npm workspaces root
├── tsconfig.base.json
├── .env.example
├── shared/                 # @vinted-system/shared
├── vinted-bot/             # @vinted-system/vinted-bot → :4701
├── temu-bot/               # @vinted-system/temu-bot   → :4702
├── orchestrator/           # @vinted-system/orchestrator → :4700
└── dashboard/              # @vinted-system/dashboard  → :5173
```

---

## Bekannte Einschränkungen

- Kein Captcha-Solving: tritt ein Captcha auf, pausiert der Bot und alerted im Dashboard. Du musst manuell lösen.
- Keine automatische Produkt-Suche auf Temu: Temu-URL + Variante werden pro Listing händisch gepflegt.
- Ein Vinted-Account und ein Temu-Account pro Installation (kein Multi-Tenant).
- Adress-Parser für Vinted-Käufer ist Best-Effort; exotische Formate können fehlen — dann Adresse im Sale-Datensatz manuell nachpflegen (JSON).
- Rechtliche Pflichten (Impressum, Widerruf, Steuer) sind nicht Teil dieses Systems — extern regeln.
