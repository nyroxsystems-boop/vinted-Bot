import { useEffect, useState } from 'react';
import { Apple, MonitorDown, Download, FileCheck2, ShieldCheck, Link as LinkIcon, AlertTriangle, Terminal } from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';

interface ReleaseAsset {
  name: string;
  url: string;
  size: string;
  platform: 'mac-arm64' | 'mac-x64' | 'windows-x64';
  sha256?: string;
}

interface Release {
  version: string;
  released_at: string;
  notes: string[];
  assets: ReleaseAsset[];
}

export function DownloadsPage() {
  const [release, setRelease] = useState<Release | null>(null);
  const [error] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/releases/latest');
        if (!r.ok) throw new Error(`http ${r.status}`);
        const data = await r.json();
        if (data.ok) setRelease(data.release);
        else throw new Error(data.error ?? 'failed');
      } catch {
        // API not reachable — fall back to a placeholder so the page still renders.
        setRelease({
          version: '0.5.0',
          released_at: new Date().toISOString(),
          notes: [
            'Multi-Marketplace v2 (Vinted, Kleinanzeigen, eBay-DE als First-Class-Citizens)',
            'CJ-Pipeline gehärtet: Pre-Flight Stock/Address-Check, Daily-Caps',
            'CAPTCHA Zero-Cost: lokales Whisper + Human-Behavior-Jitter',
            'Per-Plattform LLM-Variants',
            'Auto-Re-List 24 h nach Sale',
          ],
          assets: [],
        });
      }
    })();
  }, []);

  return (
    <div className="min-h-screen">
      <Nav />

      <section className="py-20">
        <div className="container-narrow">
          <div className="text-center">
            <span className="eyebrow">
              <Download size={12} /> Download
            </span>
            <h1 className="h-display mt-6">Hol dir <span className="gradient-text">Blackruby.</span></h1>
            <p className="mt-4 text-zinc-400">
              Native Apps für Mac (Apple Silicon &amp; Intel) und Windows 10/11. Tauri-basiert,
              100 % lokal. Beim ersten Start ein kurzer Sicherheitshinweis — die Anleitung unten.
            </p>
          </div>

          {error && (
            <div className="card-glass mt-10 text-sm text-rose-300">
              {error}
            </div>
          )}

          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            <PlatformCard
              icon={Apple}
              title="macOS — Apple Silicon"
              subtitle="M1, M2, M3, M4"
              asset={release?.assets.find((a) => a.platform === 'mac-arm64')}
              fallbackVersion={release?.version}
            />
            <PlatformCard
              icon={Apple}
              title="macOS — Intel"
              subtitle="x86_64, macOS 11+"
              asset={release?.assets.find((a) => a.platform === 'mac-x64')}
              fallbackVersion={release?.version}
            />
            <PlatformCard
              icon={MonitorDown}
              title="Windows 10 / 11"
              subtitle="64-bit, signiert"
              asset={release?.assets.find((a) => a.platform === 'windows-x64')}
              fallbackVersion={release?.version}
            />
          </div>

          <FirstLaunchGuide />

          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
            <InfoBlock
              icon={ShieldCheck}
              title="Sicher &amp; lokal"
              body="100 % auf deinem Rechner. Listings, Cookies und API-Keys verlassen dein Gerät nicht. Open-Source-Stack: Tauri (Rust) + React + SQLite."
            />
            <InfoBlock
              icon={FileCheck2}
              title="Updates per Mitglieder-Bereich"
              body="Sobald eine neue Version verfügbar ist, zeigt die App einen Hinweis. Download im Mitglieder-Bereich + Drag-and-Drop ersetzt die alte Version."
            />
          </div>

          {release && release.notes.length > 0 && (
            <div className="card-glass mt-10">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Release Notes
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="font-display text-2xl font-extrabold text-white">v{release.version}</span>
                    <span className="text-xs text-zinc-500">
                      {new Date(release.released_at).toLocaleDateString('de-DE')}
                    </span>
                  </div>
                </div>
              </div>
              <ul className="mt-5 space-y-2">
                {release.notes.map((n, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-300">
                    <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-ruby-400" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}

function PlatformCard({
  icon: Icon,
  title,
  subtitle,
  asset,
  fallbackVersion,
}: {
  icon: typeof Apple;
  title: string;
  subtitle: string;
  asset?: ReleaseAsset;
  fallbackVersion?: string;
}) {
  return (
    <div className="card-glass transition hover:border-white/20">
      <div className="mb-4 flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-ruby-500/20 to-indigo-500/20 text-ruby-300 ring-1 ring-ruby-500/20">
          <Icon size={20} />
        </div>
        <div>
          <div className="text-base font-semibold text-white">{title}</div>
          <div className="text-xs text-zinc-500">{subtitle}</div>
        </div>
      </div>

      {asset ? (
        <>
          <a href={asset.url} className="btn-primary w-full justify-center">
            <Download size={15} /> Download · {asset.size}
          </a>
          <div className="mt-3 text-[11px] text-zinc-500">
            v{fallbackVersion} · {asset.name}
          </div>
          {asset.sha256 && (
            <details className="mt-2 text-[10px] text-zinc-600">
              <summary className="cursor-pointer hover:text-zinc-400">SHA-256</summary>
              <code className="mt-1 block break-all font-mono">{asset.sha256}</code>
            </details>
          )}
        </>
      ) : (
        <button disabled className="btn-ghost w-full justify-center">
          <LinkIcon size={14} /> Bald verfügbar
        </button>
      )}
    </div>
  );
}

function InfoBlock({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}) {
  return (
    <div className="card-glass">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20">
        <Icon size={18} />
      </div>
      <div className="text-base font-semibold text-white" dangerouslySetInnerHTML={{ __html: title }} />
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

function FirstLaunchGuide() {
  return (
    <div className="mt-10 overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.04]">
      <div className="flex items-start gap-3 border-b border-amber-500/20 px-5 py-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
          <AlertTriangle size={17} />
        </div>
        <div>
          <h3 className="font-display text-base font-bold text-amber-100">
            Beim ersten Start: 10 Sekunden Setup
          </h3>
          <p className="mt-0.5 text-xs text-amber-200/80">
            Blackruby ist nicht über Apple/Microsoft signiert (würde monatlich 99 $ + 600 € kosten).
            Beim ersten Start zeigen Mac und Windows einen Sicherheitshinweis — so umgehst du ihn:
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
        <div className="border-b border-amber-500/15 px-5 py-5 md:border-b-0 md:border-r">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-100">
            <Apple size={15} /> macOS
          </div>
          <ol className="space-y-2 text-sm text-amber-100/90">
            <li className="flex gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-200">1</span>
              <span>Lade <span className="font-mono text-amber-200">Blackruby.dmg</span> herunter und öffne sie.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-200">2</span>
              <span>Ziehe <span className="font-mono text-amber-200">Blackruby</span> in den <span className="font-mono text-amber-200">Programme</span>-Ordner.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-200">3</span>
              <span><b className="text-amber-100">Rechtsklick</b> auf Blackruby → <b className="text-amber-100">Öffnen</b> → im Dialog erneut <b>Öffnen</b>. Nur beim ersten Start nötig.</span>
            </li>
          </ol>
          <details className="mt-4 text-xs text-amber-200/70">
            <summary className="cursor-pointer hover:text-amber-100">
              Falls "Beschädigt"-Fehler erscheint (Apple Quarantine)
            </summary>
            <div className="mt-2 rounded-lg border border-amber-500/20 bg-black/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-300/80">
                <Terminal size={11} /> Terminal
              </div>
              <code className="block whitespace-pre-wrap break-all font-mono text-xs text-amber-100">
                xattr -dr com.apple.quarantine /Applications/Blackruby.app
              </code>
            </div>
          </details>
        </div>

        <div className="px-5 py-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-100">
            <MonitorDown size={15} /> Windows
          </div>
          <ol className="space-y-2 text-sm text-amber-100/90">
            <li className="flex gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-200">1</span>
              <span>Lade <span className="font-mono text-amber-200">Blackruby-setup.exe</span> herunter und führe sie aus.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-200">2</span>
              <span>SmartScreen zeigt "PC schützen". Klicke <b className="text-amber-100">Weitere Informationen</b>.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-200">3</span>
              <span>Dann <b className="text-amber-100">Trotzdem ausführen</b> klicken. Setup läuft normal weiter.</span>
            </li>
          </ol>
          <p className="mt-4 text-xs text-amber-200/70">
            Diese Warnung erscheint einmalig, weil wir kein 600 €/Jahr EV-Cert nutzen.
            Die App ist <span className="text-amber-100">100 % open-source</span> auditierbar.
          </p>
        </div>
      </div>
    </div>
  );
}
