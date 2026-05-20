# Releases & In-App Updates

Customer-Side erscheint **automatisch** ein Banner "Update verfügbar: v0.5.x"
oben im Dashboard. Klick → Modal mit Progress-Bar → fertig in ~30 s.
Kein neuer DMG, kein manueller Download, kein git.

Dieses Dokument beschreibt wie **du** ein Release baust und ausrollst.

---

## Setup (einmalig)

### 1. Ed25519 Signing-Keypair erzeugen

```bash
node -e "const k=require('crypto').generateKeyPairSync('ed25519');\
 console.log('priv=' + k.privateKey.export({format:'der',type:'pkcs8'}).toString('hex'));\
 console.log('pub='  + k.publicKey.export({format:'der',type:'spki'}).toString('hex').slice(-64))"
```

Der **private Key** (privater pkcs8-DER hex) gehört in deinen Safe + CI-Secrets,
nie ins Repo. Der **public key** sind die letzten 64 Hex-Zeichen des SPKI-DER —
die rohen 32 Bytes des Ed25519-Public.

### 2. Public-Key in den Tauri-Build einbauen

```bash
# Bei jedem Release-Build:
export BLACKRUBY_RELEASE_PUBKEY=<pub-key-hex>
npm run app:build
```

Der Wert wird via `option_env!` ins Binary compiled. Ohne ihn überspringt der
Updater die Signaturprüfung mit einer Warning (Dev-Modus). **Produktions-Builds
MÜSSEN die Variable gesetzt haben.**

### 3. Manifest-Server konfigurieren

Standard: App fragt `https://blackruby.app/api/releases/tarball/<current>`.

Override per Customer (z.B. Staging-Channel):
```bash
export BLACKRUBY_MANIFEST_URL=https://staging.blackruby.app
```

---

## Ein neues Release schneiden

```bash
# 1. Version bumpen in app/package.json + dashboard/package.json
# 2. Code mergen, sicherstellen dass alles funktioniert
# 3. Dashboard bauen (sonst landet alter Frontend-Bundle im tarball)
npm run -w @vinted-system/dashboard build

# 4. Tarball bauen + signieren
RELEASE_SIGNING_KEY=$(cat ~/.blackruby/signing.key) \
  node scripts/release-tarball.mjs \
    --version 0.5.1 \
    --notes "CJ Tracking-Sync stabilisiert" \
    --notes "Sale-Detection auf Kleinanzeigen verbessert"

# Output:
#   dist/release/0.5.1/system.tar.gz       (~12 MB)
#   dist/release/0.5.1/system.tar.gz.sha256
#   dist/release/0.5.1/system.tar.gz.sig
#   marketing/data/releases.json           (manifest aktualisiert)

# 5. Upload zu blackruby.app
rsync -avz dist/release/0.5.1/ blackruby.app:/srv/dist/release/0.5.1/
rsync -avz marketing/data/releases.json blackruby.app:/srv/marketing/data/

# 6. Marketing-API neu starten (oder watcht das File-System sowieso)
ssh blackruby.app 'systemctl restart blackruby-marketing'
```

Sobald `releases.json` neu ist:
- Alle laufenden Apps polln stündlich → sehen Banner "Update verfügbar"
- User klickt → 30 s Download/Verify/Apply → fertig
- **Auto-Publisher pickt nach Restart automatisch weiter** (DB bleibt unverändert)

---

## Was wird upgedatet, was nicht

**Drin im tarball:**
- `orchestrator/`, `shared/`, alle `*-bot/` Sources
- `dashboard/dist/` (gebautes Frontend)
- `marketing/api/` (Customer-side updates erst beim nächsten Customer-Restart sichtbar)
- `package.json`, `package-lock.json`

**Nicht drin:**
- `app/src-tauri/` — die native Tauri-Shell. Änderungen hier brauchen einen
  neuen DMG/EXE, weil der laufende Process die alte Shell IST.
- `data/`, `node_modules/`, `*.db` — bleiben unangetastet.

Das Release-Script erkennt automatisch Rust-Änderungen seit dem letzten Tag
und setzt `requires_native_reinstall: true`. Die App zeigt dann einen
gelben Banner mit Link zum Installer statt einem Update-Button.

---

## Was passiert wenn ein Update fehlschlägt

| Phase | Failure-Modus | Recovery |
|-------|---------------|----------|
| Download | Network-Error, 404 | Toast-Error, alte Version läuft weiter |
| SHA-256 mismatch | corrupt download | Abort, Backup unberührt, alte Version |
| Signature mismatch | tampered tarball | Abort, alte Version |
| Extract | Permission denied, Disk full | Tarball-Datei ist noch da, kein partial state |
| `npm install` | Network, conflict | Tarball schon extracted — `.backup/<old>/` enthält `package.json/lock` zum manuellen Rollback |
| Services start | tsx crash | Status-Banner zeigt failed-Service, User kann manuell restart |

Backup-Snapshot landet in `~/Blackruby/.backup/<old-version>/` —
manueller Rollback: `cp .backup/<old>/package*.json . && npm install && restart`.

---

## Test-Cycle (jedes Mal vor Push)

```bash
# 1. Dry-run zeigt was ins tarball käme
node scripts/release-tarball.mjs --version 0.5.1-test --dry-run

# 2. Echten Tarball bauen, lokal hosten
node scripts/release-tarball.mjs --version 0.5.1 \
  --notes "Test"

# 3. Marketing-API lokal starten + releases.json zeigt die neue Version
cd marketing && npm run dev   # → http://localhost:5181

# 4. Dashboard mit anderer current-version starten
BLACKRUBY_MANIFEST_URL=http://localhost:5181 npm run app:dev
# → Banner sollte erscheinen

# 5. Klick "Jetzt aktualisieren" → Progress läuft durch → Services bouncen
```

---

## CI / GitHub Actions (TODO)

```yaml
# .github/workflows/release-tarball.yml
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run -w @vinted-system/dashboard build
      - run: node scripts/release-tarball.mjs --version "${GITHUB_REF_NAME#v}"
        env:
          RELEASE_SIGNING_KEY: ${{ secrets.RELEASE_SIGNING_KEY }}
      - run: aws s3 sync dist/release/ s3://blackruby-releases/
      - run: aws s3 cp marketing/data/releases.json s3://blackruby-releases/manifest/
```

Aktuell macht das niemand — manuelles `rsync` reicht solange du der einzige
Maintainer bist. CI wird wichtig wenn andere Devs releasen.
