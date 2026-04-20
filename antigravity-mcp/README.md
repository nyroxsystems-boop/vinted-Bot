# `@vinted-system/antigravity-mcp`

A Model Context Protocol (MCP) server that lets Google Antigravity drive
the Vinted product-generation queue autonomously.

## What it does

Exposes five tools to the Antigravity agent:

| Tool | Purpose |
|---|---|
| `wait_for_next_product` | Blocks up to 60s for a new `_queue/{N}_input.json`. Returns the full product payload (flatlay, gallery, description, attributes). |
| `mark_product_generating` | Flips DB status to `generating`. |
| `mark_product_done` | Moves queue file → `_done/`, DB → `ready`, stashes generated image paths. |
| `mark_product_failed` | DB → `failed`, stores error — queue file stays for retry. |
| `queue_status` | Counters for dashboard / end-of-run summary. |

All status writes land in the shared `orchestrator/data/vinted-system.db`,
so the main app dashboard shows live progress without any extra wiring.

## One-time setup in Antigravity

1. Open Antigravity → **Manage MCP Servers** → **View raw config**.
2. Edit `~/.gemini/antigravity/mcp_config.json` — add under `mcpServers`:

   ```json
   {
     "mcpServers": {
       "vinted-queue": {
         "command": "/Users/home/Desktop/Partsunion/Vinted-System/node_modules/.bin/tsx",
         "args": [
           "/Users/home/Desktop/Partsunion/Vinted-System/antigravity-mcp/src/index.ts"
         ]
       }
     }
   }
   ```

3. **Fully quit + reopen** Antigravity so it re-reads the config.
4. In the agent chat, ask *"List available MCP tools"* — you should see
   the five `vinted-queue` tools.

## The Adeline agent prompt

Paste this as the system/agent prompt in Antigravity:

```
Du bist der Adeline-Generator für Vinted-Listings.

Dein Loop:

1. Rufe wait_for_next_product.
   - Wenn pending=false → sofort nochmal aufrufen (polling).
   - Wenn pending=true → weiter mit Schritt 2.
2. Rufe mark_product_generating(folder_num).
3. Generiere 5 Lifestyle-Bilder nach dem Adeline-Workflow:
   - Produkt = source_flatlay (+ source_gallery für Seite/Rücken-Shots)
   - @model = Adeline (siehe identity-file in /Users/home/Desktop/Vinted/_config/)
   - @umgebung = abwechselnd: Spiegel-Selfie, Outdoor-Terrasse, Studio,
     Café-Innen, Natur-Hintergrund
   - @pose + @mimic je Bild variieren
   - Referenziere temu_description + temu_attributes für akkurate
     Material-/Fit-/Farb-Angaben
4. Speichere die 5 Bilder nach {folder_path}/generated/image_1.jpg …
   image_5.jpg (folder_path steht in product.folder_path oder wird über
   "Neuer Ordner {folder_num}" abgeleitet).
5. Rufe mark_product_done(folder_num, [absoluteImagePfade]).
6. Zurück zu Schritt 1.

Bei unerwarteten Fehlern:
- Rufe mark_product_failed(folder_num, "fehlerbeschreibung") und mache
  mit Schritt 1 weiter.
```

## How it runs

- Antigravity launches the stdio subprocess on the first tool call and
  keeps it alive for the whole session.
- The subprocess is a normal Node/tsx process — kill it by quitting
  Antigravity or by `pkill -f antigravity-mcp`.
- Logs go to **stderr** (Antigravity captures them in its MCP pane);
  stdout is reserved for JSON-RPC.

## Manual smoke test

```bash
cd /Users/home/Desktop/Partsunion/Vinted-System
node /tmp/mcp-handshake.js   # see antigravity-mcp commit for this script
```

Should print the tools list and a live `queue_status`.

## Gotchas

- **Do not `console.log`** inside the server — it corrupts JSON-RPC on
  stdout. Use the `log()` helper (writes to stderr).
- The 60s `wait_for_next_product` timeout is deliberate: Antigravity's
  transport has its own timeout, so we never block longer than 60s.
  The agent polls in a loop — that's normal.
- Status updates land in the DB via absolute paths, so it doesn't
  matter from which working directory Antigravity launches us.
