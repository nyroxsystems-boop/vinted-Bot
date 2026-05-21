# Blackruby — Quickstart für End-Kunden

Willkommen. In 10 Minuten läuft dein Hustle auf Autopilot.

---

## 1. Installation

### Mac (Apple Silicon oder Intel)
1. **`Blackruby.dmg` herunterladen** von [blackruby.de/downloads](https://blackruby.de/downloads)
2. **Doppelklick** auf die DMG → ziehe Blackruby in den Programme-Ordner
3. **Rechtsklick** auf Blackruby in Programme → **Öffnen** → noch einmal **Öffnen**
   (Nur beim ersten Start nötig — wir sind nicht über Apple signiert, aber die App ist 100 % sicher)

**Fehler "Datei beschädigt"?**
Öffne Terminal und führe aus:
```bash
xattr -dr com.apple.quarantine /Applications/Blackruby.app
```
Dann normal starten.

### Windows 10 / 11
1. **`Blackruby-setup.exe` herunterladen**
2. Doppelklick — SmartScreen warnt: **"PC schützen"** → klicke **Weitere Informationen** → **Trotzdem ausführen**
3. Installer durchklicken — fertig

---

## 2. Erste Aktivierung

Beim ersten Start öffnet sich der Lizenz-Aktivierungs-Bildschirm.

1. **Lizenz-Key** aus deiner Kauf-E-Mail kopieren (Format: `BRBY-XXXX-XXXX-XXXX-XXXX-XXXX`)
2. Einfügen + **Aktivieren** klicken
3. Du landest im Onboarding-Wizard

---

## 3. Onboarding-Wizard (5 Min)

Der Wizard führt dich durch:

| Schritt | Was du tust |
|---|---|
| **Willkommen** | Übersicht — einfach „Weiter" klicken |
| **Vinted-Login** | Browser-Fenster öffnet sich → manuell einloggen → Session wird gespeichert |
| **CJ Dropshipping** | API-Key + E-Mail eintragen (oder überspringen) — Setup unter [app.cjdropshipping.com](https://app.cjdropshipping.com/myCJ.html#/developer) |
| **Preis-Defaults** | Listpreis (z.B. 28 €) + Min-Akzeptpreis (z.B. 19 €) |
| **Crosslist-Ziele** | Welche Marktplätze automatisch mitlisten sollen — Kleinanzeigen ist Default |
| **Fertig** | „Loslegen" — du landest auf Home |

---

## 4. Erstes Listing live bringen

1. Auf **Home** klicke auf **„Alles listen jetzt"**
2. Der Auto-Publisher startet — schiebt 1 Listing pro Minute auf Vinted (gedeckelt 30/Tag)
3. Crosslist-Worker pushed automatisch auf deine ausgewählten Marktplätze
4. Sobald Verkäufe einlaufen, erscheinen sie unter **Verkauf**

---

## 5. Tägliche Bedienung

| Was du willst | Wo es ist |
|---|---|
| Cash heute checken | Sidebar links unten („Heute") + Home Top |
| Neue Listings ansehen | **Listings** (Sidebar) |
| Verkäufe / Angebote / Chats | **Verkauf** (Sidebar) — 3 Tabs |
| Bot pausieren | Oben rechts „Pausieren" — oder ⌘K → „System pausieren" |
| Was läuft gerade? | ⌘K Command-Palette mit Status-Übersicht |

**Keyboard-Shortcuts:**
- `⌘K` / `Ctrl+K` — Command Palette (alles in einem Dialog)
- `⌘1` `⌘2` `⌘3` `⌘4` — Home / Listings / Verkauf / Settings
- `⇧1` `⇧2` `⇧3` — Tab-Wechsel innerhalb Verkauf (Verkäufe / Angebote / Chats)

---

## 6. Wenn etwas hängt

### CAPTCHA aufgepoppt
Banner oben zeigt „CAPTCHA blockiert das System". Öffne Vinted im Browser, löse das CAPTCHA, klicke **Weiter** im Banner. Häufigkeit: praktisch null wenn dein Account gewärmt ist (5–10 manuell erstellte Listings vor Bot-Start).

### Bot offline
Geh zu **Settings → Logins** und prüfe ob die Vinted-Session noch gültig ist. Falls nicht, klicke **Login starten** → manuell einloggen → fertig.

### Cloudflare-Block auf Depop
Sehr selten. App pausiert dann nur Depop, der Rest läuft weiter. Warte 6 h und probier erneut, oder reset das Browser-Profil über **Settings**.

### CJ-Bestellung schlägt fehl
Stock kann beim CJ-Lieferanten leer sein. App markiert die Sale als „failed" — du musst manuell entscheiden ob Refund oder anderes Produkt verschicken.

---

## 7. Support

- 📧 **support@blackruby.de**
- 💬 **Discord** (Lifetime-Tier nur): Link im Mitglieder-Bereich
- 📖 **Mitglieder-Bereich**: [blackruby.de/members](https://blackruby.de/members) — Lizenz-Status, Account, Updates

---

## 8. Updates

Sobald eine neue Version verfügbar ist, zeigt die App einen Hinweis (Toast unten rechts).
Lade dir die neue Version aus dem Mitglieder-Bereich und ersetze die alte App per Drag-and-Drop.
Deine Daten bleiben erhalten (SQLite-DB im Benutzerordner).

---

## 9. Datenschutz & Sicherheit

- **Keine Cloud**: Listings, Cookies, API-Keys, Verkaufsdaten leben auf deinem Rechner
- **Keine Telemetrie**: außer dem täglichen Update-Check (übermittelt nur deine App-Version, kein User-Tracking)
- **Open-Source-Stack**: Tauri (Rust) + React + SQLite — alles auditierbar
- **Lizenz-Validierung** läuft offline nach der ersten Aktivierung (HMAC-signierte Token)

Viel Erfolg beim Hustle 🚀
