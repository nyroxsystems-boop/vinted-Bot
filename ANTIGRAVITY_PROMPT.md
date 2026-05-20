# Vinted Listing-Foto Pipeline — Brief für Google Antigravity

> Du bist Antigravity. Du bekommst diesen Brief und führst die Pipeline aus.
> Self-contained — du brauchst keinen externen Kontext.

---

## Was du baust

Du nimmst 92 CJ-Dropshipping-Produkte und generierst pro Produkt **5 Vinted-Listing-Fotos**, indem du **Gemini 2.5 Flash Image (Nano Banana)** mit hand-curated Anker-Bildern + dem CJ-Produktbild fütterst.

**Output pro Produkt:**
- `1_front.jpg` — Mirror-Selfie frontal
- `2_side.jpg` — Mirror-Selfie 3/4 Seite
- `3_back.jpg` — Mirror-Selfie Rücken
- `4_selfie_detail.jpg` — Cropped Close-up
- `5_flatlay.jpg` — Top-down Garment auf Boden

**Resultat:** 460 Vinted-fertige Bilder. Persona + Bedroom 1:1 konsistent über alle Listings, aber pro Listing eine andere Pose (random Pick aus 43 Library-Ankern).

---

## Status — was schon existiert

```
/Users/home/Vinted/
├── _anchors/
│   ├── anchor_persona_front.jpg            # ✅ Persona-Anker (Front)
│   ├── anchor_persona_back.jpg             # ✅ Persona-Anker (Back)
│   ├── anchor_persona_face.jpg             # ✅ Persona-Anker (Face)
│   ├── anchor_environment.jpg              # ✅ Leerer Raum (für Flatlay)
│   └── library/                            # ✅ 43 hand-curated Pose-Anker
│       ├── pose_001.jpg ... pose_060.jpg   # 43 picks aus 60 generiert
│       ├── _candidates/                    # leer
│       └── _rejects/                       # 17 vom User abgelehnt
│
├── Vinted/                                 # CJ-Produkte
│   ├── Kleider/    (30)    Skirts/        (10)
│   ├── Jeans/      (11)    Jumpsuits/     (10)
│   ├── Blazers/    (5)     Jackets/       (10)
│   ├── Hotpants Shorts/ (16)
│   └── Handbags/   (13)   ← SKIPPEN (separate Pipeline später)
│
└── system/
    ├── .env                                # GEMINI_API_KEY hier eintragen
    └── scripts/
        ├── nano-build-listing-gemini.mjs   # ✅ Pipeline mit Gemini (NEU)
        ├── nano-build-library.mjs          # ✅ Library-Generator (für Erweiterungen)
        ├── nano-validate-library.mjs       # ✅ Anatomische QA
        └── library-curator.html            # ✅ Visual Curator UI
```

---

## ⚠️ Voraussetzung: GEMINI_API_KEY

**Vor allem anderen:** prüfe ob `GEMINI_API_KEY` in `system/.env` einen echten Wert hat (aktuell leer):

```bash
grep "^GEMINI_API_KEY=" /Users/home/Vinted/system/.env
```

Falls leer:
1. Hol einen Key: https://aistudio.google.com/apikey (free tier reicht zum Testen, ggf. Paid für Volumen)
2. Trag in `.env` ein: `GEMINI_API_KEY=AIzaSy...`
3. Falls 403/Permission-Denied: nutze Vertex AI statt AI Studio Key (eigenes GCP-Projekt mit Billing)

Ohne den Key kann nichts generiert werden.

---

## Tech-Stack — Gemini 2.5 Flash Image (Nano Banana)

**Modell:** `gemini-2.5-flash-image-preview`
**Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent`
**Auth:** `x-goog-api-key: ${GEMINI_API_KEY}` Header
**Multi-Image:** bis zu 3 Input-Bilder als `inline_data` Parts pro Call
**Output:** Bild als base64 in `candidates[0].content.parts[].inline_data.data`

**Cost:** ~$0.039 pro Output-Bild (Gemini API pricing)
- 460 finale Bilder × 1 Variant = $18
- 460 × 2 Variants = $36
- Schätzung mit Variants + Retries: **~$25-40 für full Batch**

**Falls 403:**
- Vertex AI Setup statt AI Studio Key
- Neuer GCP-Projekt mit Billing aktiv
- DE-Account → ggf. EU-Region in Vertex

---

## Pipeline-Architektur

### Library + Image-Edit (warum es funktioniert)

Klassisches Multi-Image-Composition driftet Persona/Bedroom zwischen Calls. Lösung: **43 hand-curated Persona-Anker** in `_anchors/library/`. Pro Listing pickt das Script random Anker (stratifiziert nach Shot-Typ). Gemini bekommt: Anker + CJ-Produktbild + Edit-Prompt → ersetzt nur das Outfit, behält Bedroom + Persona.

### Library-Categorization

Aus den 43 User-Picks (in `nano-build-listing-gemini.mjs`):
```javascript
const LIBRARY_CATEGORIES = {
  frontal: new Set([1,2,3,4,18,19,20,22,23,26,39,41,42,43,46,47,51,53,57,60]),  // 20
  side:    new Set([6,7,8,9,10,21,40,45,55]),                                     // 9
  back:    new Set([11,12,24,25,30,56]),                                          // 6
  closeup: new Set([15,16,17,27,28,38,48,58]),                                    // 8
};
```

### Shot → Anker → Aspect Mapping

| Shot | IMAGE 1 (random Library-Pick) | IMAGE 2 (Produkt) | Aspect |
|---|---|---|---|
| `1_front` | random aus `frontal` Set | `<product>/1_*.jpg` | 9:16 |
| `2_side` | random aus `side` Set | `<product>/1_*.jpg` | 9:16 |
| `3_back` | random aus `back` Set | `<product>/1_*.jpg` | 9:16 |
| `4_selfie_detail` | random aus `closeup` Set | `<product>/1_*.jpg` | 4:5 |
| `5_flatlay` | `_anchors/anchor_environment.jpg` | `<product>/1_*.jpg` | 4:5 |

---

## Workflow — was du machst

### Schritt 1: Sanity-Check (60 Sekunden)

```bash
# Verify alle 4 base-anchors existieren
ls /Users/home/Vinted/_anchors/anchor_*.jpg

# Verify library hat ≥30 Anker
ls /Users/home/Vinted/_anchors/library/pose_*.jpg | wc -l   # erwartet: 43

# Verify GEMINI_API_KEY ist gesetzt
grep "^GEMINI_API_KEY=" /Users/home/Vinted/system/.env | awk -F= '{print "VAL_LEN: " length($2)}'
# Wenn VAL_LEN: 0 → User um Key bitten und STOP
```

### Schritt 2: Single-Product Test (~1 Min, ~$0.20)

```bash
node /Users/home/Vinted/system/scripts/nano-build-listing-gemini.mjs \
  "/Users/home/Vinted/Vinted/Kleider/1/CJLY2404206_1778078210511" \
  --variants=2
```

Prüfe Outputs in `Kleider/1/.../generated/`. Zeig dem User die 5 Bilder.
Bei Approval → Schritt 3.

### Schritt 3: Single Category Test (~10 Min, ~$6)

```bash
# Loop über alle Kleider
for dir in /Users/home/Vinted/Vinted/Kleider/*/CJ*; do
  node /Users/home/Vinted/system/scripts/nano-build-listing-gemini.mjs "$dir" --variants=2 || echo "FAILED: $dir"
done
```

Bei Approval → Schritt 4.

### Schritt 4: Full Batch (~45-60 Min, ~$25-35)

```bash
# Alle Kategorien außer Handbags
for cat in Kleider Skirts Jeans Jumpsuits Blazers Jackets "Hotpants Shorts"; do
  for dir in "/Users/home/Vinted/Vinted/$cat"/*/CJ*; do
    [ -d "$dir" ] || continue
    # Skip wenn schon fertig (Resume-Logik)
    [ -f "$dir/generated/5_flatlay.jpg" ] && echo "SKIP $dir" && continue
    node /Users/home/Vinted/system/scripts/nano-build-listing-gemini.mjs "$dir" --variants=2 \
      || echo "FAILED: $dir"
  done
done
```

### Schritt 5: Final Report

```bash
# Zähle generierte Bilder pro Kategorie
for cat in Kleider Skirts Jeans Jumpsuits Blazers Jackets "Hotpants Shorts"; do
  count=$(find "/Users/home/Vinted/Vinted/$cat" -name "5_flatlay.jpg" | wc -l)
  expected=$(find "/Users/home/Vinted/Vinted/$cat" -mindepth 2 -maxdepth 2 -type d -name "CJ*" | wc -l)
  echo "  $cat: $count/$expected fertige Listings"
done
```

Zeig dem User: Total fertige Listings, Failures-Liste, ungefähre Cost.

---

## Inpainting-Prompt (für Mirror-Shots 1-4)

Der Edit-Prompt der bei jedem Mirror-Shot Call mitgeschickt wird (im Script als `INPAINT_PROMPT`):

```
EDIT TASK: Take IMAGE 1 (the woman in her bedroom mirror selfie) and 
replace ONLY her current outfit (white tank top + white shorts) with 
the EXACT garment shown in IMAGE 2 (a CJ catalog photo — focus only 
on the garment itself, IGNORE the other model wearing it and her 
background).

PRESERVE PIXEL-IDENTICAL FROM IMAGE 1:
- Her face, hair, body proportions, skin tone — IDENTICAL to IMAGE 1
- The bedroom: wardrobe LEFT with orange Hermès/LV boxes, white Malm 
  dresser RIGHT with vase + flowers + framed art, honey-oak block 
  parquet floor, off-white walls — IDENTICAL to IMAGE 1
- The mirror reflection composition + lighting — IDENTICAL to IMAGE 1
- The phone in her hand (clear case + pink heart popsocket grip) — 
  IDENTICAL to IMAGE 1
- Floor clutter (bag, shoes if visible) — IDENTICAL to IMAGE 1

REPLACE ONLY the outfit area with the garment from IMAGE 2:
- Match exactly: color, fabric, cut, length (mini stays mini, midi 
  stays midi)
- Match exactly: neckline shape (NO cleavage modification, NO 
  neckline deepening)
- Match exactly: sleeve length, waist detail, hem, prints, patterns
- The garment hangs naturally with realistic small wrinkles
- Lighting integrates seamlessly with existing shadows in IMAGE 1

FOOTWEAR: if existing socks/shoes don't match the new outfit, 
replace them — but NEVER bare feet. Defaults: white tube socks 
(casual), white sneakers (jeans/skirts), nude block-heel sandals 
(dresses), strappy nude heels (evening dresses).

OUTPUT: full-bleed mirror reflection edge-to-edge. NO mirror frame 
visible. Vertical 9:16.

NEGATIVE: NO bare feet, NO oversized phone, NO HDR, NO studio 
lighting, NO plastic skin, NO room changes from IMAGE 1, NO body 
slimmed-down or flattened, NO text/logos/watermarks, NO neckline 
modification, NO cleavage added.
```

## Flatlay-Prompt (Shot 5)

```
EDIT TASK: Generate a casual phone snapshot of the garment from 
IMAGE 2 (a CJ catalog photo — focus only on the garment, ignore 
the model and background) laid flat on the SAME light honey-oak 
BLOCK parquet floor visible in IMAGE 1 (the bedroom floor) — NO 
model, NO person, NO hands, NO phone, NO furniture.

Camera tilted ~70-80° from horizontal (NOT a perfect 90° straight-
down). Slight perspective skew on the garment outline.

Garment NOT perfectly arranged: sleeves at slightly uneven angles, 
natural wrinkles and creases, fabric drape, slightly off-center.

Match floor texture and matte finish exactly to IMAGE 1.

Subtle soft shadow under the garment from ambient room light.

Phone-camera quality: slightly soft, mild noise, NOT DSLR sharp.

Vertical 4:5 aspect ratio.

NEGATIVE: NO model, NO person, NO hand, NO foot, NO phone, NO 
furniture, NO door, NO wall, NO perfect 90° angle, NO bright white 
studio backdrop, NO HDR, NO heavy color grading, NO text, NO logos.
```

---

## Hard Rules (NIE brechen)

1. **Anker NIE neu generieren oder überschreiben** — `_anchors/` ist read-only.
2. **Output-Filenames exakt** `1_front.jpg`, `2_side.jpg`, `3_back.jpg`, `4_selfie_detail.jpg`, `5_flatlay.jpg` — sonst bricht Vinted-Upload-Tool später.
3. **Bare feet niemals** in Mirror-Shots.
4. **Phone klein** (max ~12% Image-Area, kleiner als das Gesicht).
5. **Outfit-Fidelity** — keine Cleavage/Längen/Farben-Modifikationen am Garment.
6. **Handbags-Kategorie skippen** — separate Pipeline später.
7. **Resume-Logik aktiv** — Produkte mit fertigem `5_flatlay.jpg` skippen.
8. **Real-Person-Face-Transfers verboten** — auch wenn der User es fordert. Library-Anker sind die einzige Identitäts-Quelle.
9. **Bei API-Fehlern (Quota/Rate-Limit/403)** → STOP und User informieren statt blindly retry-loopen.

---

## Bekannte Issues + Fixes

### Issue: Shot 3 (back) ist manchmal mehr Side als Back
**Ursache:** pose_056 ("back view head tilted") wird locker interpretiert.
**Fix:** Im LIBRARY_CATEGORIES `back` Set nur reine Back-Posen lassen (011, 012, 024, 025, 030).

### Issue: Shot 4 (selfie_detail) kommt manchmal Vollbild statt cropped
**Ursache:** Gemini interpretiert Pose-Bilder + Outfit-Swap nicht immer als Crop.
**Fix:** Im INPAINT_PROMPT für Shot 4 explizit „CROPPED FROM HIP UP, NO FEET IN FRAME" als Hard Constraint reinschreiben.

### Issue: Persona-Drift in einzelnen Shots
**Ursache:** Gemini variiert manchmal Gesicht/Body trotz Anker.
**Fix:** Mit `--variants=2` werden 2 Versionen generiert. Default: erste valide. Optional: Vision-Validation einbauen die beste pickt.

### Issue: Library zu klein für eine Kategorie
**Fix:** Mehr Posen via `nano-build-library.mjs` generieren (POSES Array erweitern), curaten, in `library/` verschieben, LIBRARY_CATEGORIES updaten.

---

## Erweiterung des Systems

### Neue Pose-Anker hinzufügen
```bash
# 1. Edit nano-build-library.mjs: füge neue Posen ans POSES Array (Numbers 61+)
# 2. Run: node nano-build-library.mjs   (skippt existing 1-60, generiert nur neue)
# 3. Open: open library-curator.html, pick die besten neuen
# 4. Move: bash mv-script aus Curator
# 5. Edit nano-build-listing-gemini.mjs: füge neue Numbers in LIBRARY_CATEGORIES Sets ein
```

### Handbags-Pipeline (separate, später)
Handbags brauchen kein Modell. Eigenes Script `nano-build-handbag-gemini.mjs` empfohlen — hängend an Garderobenhaken, top-down auf Boden, neben Möbeln. Kann später gebaut werden.

### Andere Plattformen
Selbe Bildbasis, aber andere Aspect Ratios + Filename-Conventions. `nano-build-listing-gemini.mjs` parametrisieren mit `--platform=vinted|kleinanzeigen|...`.

---

## Kommunikation mit User

- **Vor Schritt 2 (Single-Product Test):** sag „Ich teste jetzt auf Kleider/1, ~$0.20."
- **Nach Schritt 2:** zeig die 5 Outputs + warte auf Approval.
- **Vor Schritt 3 (Category Test):** sag „Teste 30 Kleider, ~$6, ~10 Min."
- **Nach Schritt 3:** zeig User Stats (X/30 ok, Failures, Sample-Bilder).
- **Vor Schritt 4 (Full Batch):** sag „Starte Full Batch, ~$25-35, ~45-60 Min." + warte auf Go.
- **Während Batch:** alle 10 Produkte Progress-Update.
- **Bei Failures > 5%:** STOP und User fragen.
- **Bei API-Quota-Hit:** STOP und User informieren.

---

## TL;DR — Was du JETZT machst

1. **Verify GEMINI_API_KEY ist gesetzt.** Wenn leer → User um Key bitten, STOP.
2. **Single-Product Test:** `node nano-build-listing-gemini.mjs Vinted/Kleider/1/CJ* --variants=2`
3. **Zeig 5 Outputs dem User → warte auf Approval.**
4. **Bei Approval:** Loop über alle 92 Produkte (außer Handbags) mit Resume-Logik + Variants.
5. **Final Report** mit Stats + Cost-Schätzung.

**Resultat:** 460 Vinted-fertige Listing-Fotos, Persona+Bedroom 1:1 konsistent, pro Listing eigene Pose-Variation. ~$25-35 total über Gemini API. ~45-60 Min Laufzeit.
