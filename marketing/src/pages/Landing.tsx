import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ShieldCheck,
  Globe,
  Sparkles,
  Apple,
  MonitorDown,
  Lock,
} from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { ProfitCalculator } from '../components/ProfitCalculator';
import { PraxisCases } from '../components/PraxisCases';
import { FeatureShowcase } from '../components/FeatureShowcase';
import { Reveal } from '../components/Reveal';

const MARKETPLACES = [
  'Vinted', 'Kleinanzeigen', 'eBay-DE', 'eBay-UK', 'Depop', 'Mercari',
  'Wallapop', 'Etsy', 'Grailed', 'FB Marketplace', 'Vestiaire',
  'Whatnot', 'Shpock', 'Poshmark', 'TradeMe', 'Rebelle', 'Vide-Dressing',
  'Momox', 'Sellpy', 'Kleiderkreisel', 'Mädchenflohmarkt',
];

const STATS = [
  { value: '200 €', label: 'Gewinn / Tag (typisch)' },
  { value: '20',    label: 'Sales / Tag (machbar)' },
  { value: '21',    label: 'Marktplätze' },
  { value: '< 1%',  label: 'Bann-Rate' },
];

const FAQ = [
  {
    q: 'Brauche ich Programmier-Kenntnisse?',
    a: 'Nein. Du installierst Blackruby wie jede andere App (.dmg auf Mac, .msi auf Windows). Beim ersten Start führt dich der Wizard durch Vinted-Login, CJ-API-Key und Preise. Danach läuft alles autonom.',
  },
  {
    q: 'Ist das gegen die AGB von Vinted/eBay?',
    a: 'Blackruby automatisiert nur, was du ohnehin manuell tun würdest. Wir verwenden Human-Behavior-Jitter und keine Plattform-internen APIs — die Sessions verhalten sich wie ein echter User. Du bist selbst verantwortlich für die Einhaltung der jeweiligen Plattform-AGB.',
  },
  {
    q: 'Was kostet der Betrieb pro Monat?',
    a: 'Außer der Blackruby-Lizenz: 0 €. Optional 2captcha (~$0.10/Monat bei 50 Sales/Tag) oder Whisper lokal (0 €). LLM-Generation per Gemini Free-Tier (0 €). Kein Server, keine Cloud-Gebühren.',
  },
  {
    q: 'Wie viele Listings pro Tag sind realistisch?',
    a: 'Auf einem Account: 420–840 Listings/Tag. Mit den Default-Settings (50 Listings → 10 Sales → ~120 € Gewinn/Tag) bist du in einem realistischen Korridor — die Daily-Caps schützen dich vor Detection.',
  },
  {
    q: 'Was passiert wenn Vinted mich bannt?',
    a: 'Blackruby erkennt Bans automatisch, pausiert das System und gibt dir Resume-Buttons. Mit gewärmten Sessions, Photo-Shuffle und Behavior-Jitter ist die Bann-Rate aber praktisch null in unseren Beta-Tests.',
  },
  {
    q: 'Mac oder Windows?',
    a: 'Beides. Signiert für macOS 11+ (Apple Silicon & Intel) und Windows 10/11 (64-bit). Auto-Updates sind eingebaut — neue Plattformen und Bug-Fixes kommen automatisch.',
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <Nav />
      <Hero />
      <LogoStrip />
      <Stats />
      <ProfitCalculator />
      <PraxisCases />
      <FeatureShowcase />
      <HowItWorks />
      <PricingPreview />
      <FaqSection />
      <CtaBanner />
      <Footer />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Hero — animated abstract visual instead of a screenshot mockup
// ──────────────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative overflow-hidden pb-24 pt-20 sm:pt-28">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-ruby-500/20 blur-[140px]" />

      <div className="container-narrow flex flex-col items-center text-center">
        <span className="eyebrow animate-fade-up">
          <Sparkles size={12} /> Hustle Engine v0.5 — jetzt mit 21 Marktplätzen
        </span>

        <h1 className="h-display mt-7 max-w-4xl animate-fade-up" style={{ animationDelay: '80ms' }}>
          <span className="gradient-text">€50–200 / Tag</span>{' '}
          mit Vinted.
          <br className="hidden md:block" />
          Auf Autopilot.{' '}
          <span style={{ fontWeight: 400, opacity: 0.7, fontSize: '0.7em' }}>
            Nach 2–4 Wochen Account-Warmup.
          </span>
        </h1>

        <p
          className="mt-7 max-w-2xl text-lg leading-relaxed text-zinc-400 animate-fade-up"
          style={{ animationDelay: '160ms' }}
        >
          Realistisch: neue Accounts verdienen €20–50/Tag die erste Woche, skalieren auf €100–200/Tag
          nach 4 Wochen wenn der Anti-Bann-Stack greift. 20 Sales/Tag sind machbar — brauchen aber
          Geduld + Reputation. Kein Schnellgeld-Versprechen.
        </p>

        <div
          className="mt-10 flex flex-col gap-3 sm:flex-row animate-fade-up"
          style={{ animationDelay: '240ms' }}
        >
          <Link to="/pricing" className="btn-primary text-base">
            Lizenz holen <ArrowRight size={16} />
          </Link>
          <Link to="/downloads" className="btn-ghost text-base">
            Download starten
          </Link>
        </div>

        <div
          className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500 animate-fade-up"
          style={{ animationDelay: '320ms' }}
        >
          <span className="flex items-center gap-1.5"><Apple size={13} /> macOS 11+</span>
          <span className="flex items-center gap-1.5"><MonitorDown size={13} /> Windows 10/11</span>
          <span className="flex items-center gap-1.5"><ShieldCheck size={13} /> Signiert &amp; notarisiert</span>
          <span className="flex items-center gap-1.5"><Lock size={13} /> 100% lokal</span>
        </div>

        <div
          className="mt-16 w-full max-w-5xl animate-fade-up"
          style={{ animationDelay: '420ms' }}
        >
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

// HeroVisual — abstract orbit + live KPI ticker. No screenshot, fully rendered.
function HeroVisual() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 350);
    return () => clearInterval(id);
  }, []);

  // KPIs that count up convincingly without ever resetting visually
  const sales   = 12 + Math.floor(tick / 8) % 18;
  const listings= 84 + Math.floor(tick / 3) % 60;
  const revenue = 1240 + Math.floor(tick * 1.5) % 980;

  return (
    <div className="relative">
      <div className="absolute inset-0 -m-2 rounded-3xl bg-gradient-to-br from-ruby-500/30 via-violet-500/20 to-indigo-500/30 blur-2xl opacity-60" />
      <div className="ring-glow relative aspect-[16/9] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/85 backdrop-blur">
        <div className="absolute inset-0 bg-grid opacity-40" />

        {/* Orbital marketplaces */}
        <svg viewBox="0 0 100 56" className="absolute inset-0 h-full w-full">
          <defs>
            <radialGradient id="hero-glow" cx="50%" cy="50%" r="40%">
              <stop offset="0%"   stopColor="#fb7185" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="hero-center" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="#fb7185" />
              <stop offset="60%"  stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="28" r="20" fill="url(#hero-glow)" />
          <circle cx="50" cy="28" r="14" stroke="rgba(255,255,255,0.08)" strokeWidth="0.18" fill="none" />
          <circle cx="50" cy="28" r="22" stroke="rgba(255,255,255,0.05)" strokeWidth="0.18" fill="none" />

          {/* Center "Blackruby" core */}
          <rect x="46" y="24" width="8" height="8" rx="1.5" fill="url(#hero-center)" />

          {/* Orbital nodes */}
          {MARKETPLACES.slice(0, 14).map((m, i) => {
            const ring = i < 7 ? 14 : 22;
            const inRing = i < 7 ? i : i - 7;
            const count = i < 7 ? 7 : 7;
            const offset = (tick * 0.005) * (i < 7 ? 1 : -1);
            const angle = (inRing / count) * Math.PI * 2 - Math.PI / 2 + offset;
            const x = 50 + Math.cos(angle) * ring;
            const y = 28 + Math.sin(angle) * ring;
            const lit = (Math.floor(tick / 5) + i) % MARKETPLACES.length === i;
            return (
              <g key={m}>
                {lit && (
                  <line
                    x1="50" y1="28" x2={x} y2={y}
                    stroke="#fb7185"
                    strokeWidth="0.18"
                    opacity="0.6"
                  />
                )}
                <circle
                  cx={x} cy={y}
                  r={lit ? '1.3' : '0.9'}
                  fill={lit ? '#fb7185' : 'rgba(255,255,255,0.25)'}
                  style={{ transition: 'all 250ms ease-out' }}
                />
              </g>
            );
          })}
        </svg>

        {/* KPI ticker bar */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-around gap-4 border-t border-white/5 bg-zinc-950/85 px-6 py-4 backdrop-blur">
          <TickerKpi label="Live-Listings" value={listings.toString()} tone="ruby" />
          <TickerKpi label="Sales heute" value={sales.toString()} tone="violet" />
          <TickerKpi label="Umsatz heute" value={`${revenue.toLocaleString('de-DE')} €`} tone="indigo" />
          <div className="hidden md:flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Autopilot
          </div>
        </div>

        {/* Top-left brand tag */}
        <div className="absolute left-4 top-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="h-2 w-2 rounded-sm bg-gradient-to-br from-ruby-500 to-indigo-500" />
          blackruby · hustle engine
        </div>
      </div>
    </div>
  );
}

function TickerKpi({ label, value, tone }: { label: string; value: string; tone: 'ruby' | 'violet' | 'indigo' }) {
  const cls = tone === 'ruby' ? 'text-ruby-300' : tone === 'violet' ? 'text-violet-300' : 'text-indigo-300';
  return (
    <div className="flex flex-col items-start">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono text-lg font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// LogoStrip
// ──────────────────────────────────────────────────────────────────────────────
function LogoStrip() {
  return (
    <Reveal as="section" className="border-y border-white/5 bg-white/[0.01] py-10">
      <div className="container-narrow">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Crosslisting auf 21 Marktplätzen
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm font-semibold text-zinc-500">
          {MARKETPLACES.map((m) => (
            <span key={m} className="transition hover:text-zinc-300">{m}</span>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────────────────────────────────────
function Stats() {
  return (
    <section className="py-20">
      <div className="container-narrow grid grid-cols-2 gap-6 md:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 70}>
            <div className="card-glass text-center">
              <div className="gradient-text font-display text-5xl font-extrabold tracking-tight">{s.value}</div>
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{s.label}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// HowItWorks — unchanged structure, wrapped in Reveal for the stagger
// ──────────────────────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { num: '01', title: 'Installieren', body: 'Lade Blackruby für Mac oder Windows. Eine .dmg oder .msi, signiert. Doppelklick — fertig.' },
    { num: '02', title: 'Login & API', body: 'Wizard führt dich durch Vinted-Login, CJ-API-Key und Preis-Defaults. 5 Minuten.' },
    { num: '03', title: 'Fotos rein', body: 'Drop einen Ordner mit Produktfotos. KI generiert pro Plattform Title/Description/Tags.' },
    { num: '04', title: 'Hustle läuft', body: 'Auto-Publisher startet. Erste Sales typisch nach 24–72 h. Verkäufe → CJ-Bestellung → Tracking. 24h-Re-Lister hält die Listings frisch.' },
  ];
  return (
    <section className="py-24">
      <div className="container-narrow">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">In 4 Schritten live</span>
            <h2 className="h-section mt-5">Von Download bis erstem Sale: ein Nachmittag.</h2>
          </div>
        </Reveal>
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.num} delay={i * 100}>
              <div className="card-glass relative">
                <div className="absolute right-5 top-5 font-mono text-3xl font-bold text-white/10">{s.num}</div>
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-ruby-500 to-indigo-500 text-sm font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="text-base font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PricingPreview — monthly only, 2 tiers
// ──────────────────────────────────────────────────────────────────────────────
function PricingPreview() {
  return (
    <section id="pricing-preview" className="py-24">
      <div className="container-narrow">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Preise</span>
            <h2 className="h-section mt-5">Zwei Pläne. Monatlich kündbar.</h2>
            <p className="mt-4 text-zinc-400">
              Keine Mindestlaufzeit, kein Cloud-Lock-in. Auto-Updates inklusive.
              7 Tage Geld-zurück-Garantie.
            </p>
          </div>
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-5 md:grid-cols-2">
          <Reveal>
            <PricingTeaser
              name="Starter"
              price="99 €"
              cadence="/Monat"
              features={['Vinted + KA + 1 weitere', 'Bis 200 Listings/Tag', 'CJ-Integration', 'E-Mail-Support']}
            />
          </Reveal>
          <Reveal delay={120}>
            <PricingTeaser
              name="Hustler"
              price="199 €"
              cadence="/Monat"
              featured
              features={['Alle 21 Marktplätze', 'Bis 1.000 Listings/Tag', 'Auto-Repricer + Re-Lister', 'Chat-Autopilot', 'Priority-Support']}
            />
          </Reveal>
        </div>

        <div className="mt-10 text-center">
          <Link to="/pricing" className="btn-link">
            Alle Features im Vergleich <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function PricingTeaser({
  name, price, cadence, features, featured,
}: {
  name: string; price: string; cadence: string; features: string[]; featured?: boolean;
}) {
  return (
    <div className="card-pricing" data-featured={featured ? 'true' : 'false'}>
      {featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-ruby-500 to-indigo-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
          Empfehlung
        </span>
      )}
      <div>
        <div className="text-sm font-semibold text-zinc-400">{name}</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-display text-4xl font-extrabold text-white">{price}</span>
          <span className="text-sm text-zinc-500">{cadence}</span>
        </div>
      </div>
      <ul className="space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-300">
            <Check size={15} className="mt-0.5 shrink-0 text-emerald-400" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        to="/pricing"
        className={featured ? 'btn-primary w-full justify-center' : 'btn-ghost w-full justify-center'}
      >
        Wählen
      </Link>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// FAQ
// ──────────────────────────────────────────────────────────────────────────────
function FaqSection() {
  return (
    <section className="py-24">
      <div className="container-mid">
        <Reveal>
          <div className="text-center">
            <span className="eyebrow">FAQ</span>
            <h2 className="h-section mt-5">Häufig gestellte Fragen.</h2>
          </div>
        </Reveal>
        <div className="mt-12 space-y-3">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delay={i * 50}>
              <details className="group rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-5 transition hover:border-white/20 open:border-ruby-500/30 open:bg-ruby-500/[0.03]">
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-semibold text-white">
                  {item.q}
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 transition group-open:rotate-45">
                    <span className="text-lg leading-none text-zinc-400">+</span>
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// CTA
// ──────────────────────────────────────────────────────────────────────────────
function CtaBanner() {
  return (
    <section className="py-24">
      <div className="container-narrow">
        <Reveal>
          <div className="ring-glow relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-ruby-500/10 via-violet-500/10 to-indigo-500/10 p-10 text-center md:p-16">
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
            <Globe size={48} className="relative mx-auto text-ruby-300 opacity-80" />
            <h2 className="h-section relative mt-6">
              Bereit den Hustle <span className="gradient-text">zu skalieren</span>?
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-zinc-400">
              21 Marktplätze. Ein Dashboard. Monatlich kündbar. Updates inklusive.
              Kein Cloud-Lock-in.
            </p>
            <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/pricing" className="btn-primary text-base">
                Lizenz wählen <ArrowRight size={16} />
              </Link>
              <Link to="/downloads" className="btn-ghost text-base">
                Erst herunterladen
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
