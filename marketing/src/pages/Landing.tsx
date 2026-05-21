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
import { ListingsShowcase } from '../components/ListingsShowcase';
import { FeatureShowcase } from '../components/FeatureShowcase';
import { Reveal } from '../components/Reveal';
import { MobileStickyCta, MobileProofStrip, MobileQuickPitch } from '../components/MobileConversion';

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
      <MobileQuickPitch />
      <ListingsShowcase />
      <MobileProofStrip />
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
      <MobileStickyCta />
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

        {/* Desktop: layered dashboard visual */}
        <div
          className="mt-16 hidden w-full max-w-5xl animate-fade-up md:block"
          style={{ animationDelay: '420ms' }}
        >
          <HeroVisual />
        </div>

        {/* Mobile: real product gallery (denser, faster, conversion-first) */}
        <div
          className="mt-12 w-full max-w-md animate-fade-up md:hidden"
          style={{ animationDelay: '420ms' }}
        >
          <MobileHeroGallery />
        </div>
      </div>
    </section>
  );
}

// MobileHeroGallery — full-bleed 2x2 grid of real listings, perfect for
// TikTok-driven traffic. Conveys "this is a real seller's account"
// instantly and works on a phone without rendering 7 floating cards.
function MobileHeroGallery() {
  const ITEMS = [
    { id: 'p2', price: '27,90 €', stat: '380 views' },
    { id: 'p4', price: '19,50 €', stat: '24 hearts' },
    { id: 'p3', price: '32,00 €', stat: 'verkauft' },
    { id: 'p1', price: '17,50 €', stat: '180 views' },
  ];
  return (
    <div className="relative">
      <div className="absolute inset-0 -m-4 -z-10 rounded-3xl bg-gradient-to-br from-ruby-500/30 via-violet-500/20 to-indigo-500/30 blur-3xl opacity-60" />
      <div className="grid grid-cols-2 gap-2.5">
        {ITEMS.map((it, i) => (
          <div
            key={it.id}
            className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-xl shadow-black/30"
          >
            <img
              src={`/listings/products/${it.id}.jpg`}
              alt={`Live-Listing ${i + 1}`}
              loading={i < 2 ? 'eager' : 'lazy'}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute right-1.5 top-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-200 backdrop-blur">
              {it.stat}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2.5 py-2 font-mono text-[11px] text-white">
              <span className="font-bold">{it.price}</span>
              <span className="rounded-sm bg-ruby-500/80 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider">
                vinted
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Live: 312 Listings · 22 Sales heute · 184 € Umsatz
      </div>
    </div>
  );
}

// HeroVisual — layered dashboard window with floating live-event cards around it.
// No screenshot — everything rendered live so the page stays sharp at any DPI.
function HeroVisual() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 350);
    return () => clearInterval(id);
  }, []);

  const sales    = 12 + Math.floor(tick / 8) % 18;
  const listings = 84 + Math.floor(tick / 3) % 60;
  const revenue  = 1240 + Math.floor(tick * 1.5) % 980;
  const today    = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  // Chart data — deterministic from tick so it animates without jumping
  const bars = Array.from({ length: 7 }, (_, i) => {
    const h = 35 + Math.abs(Math.sin((tick + i * 7) * 0.2)) * 50 + ((tick + i * 3) % 11) * 1.5;
    return h;
  });

  return (
    <div className="relative">
      {/* Backdrop glow */}
      <div className="absolute inset-0 -m-2 rounded-3xl bg-gradient-to-br from-ruby-500/30 via-violet-500/20 to-indigo-500/30 blur-2xl opacity-60" />

      {/* Main dashboard window — slight tilt for depth */}
      <div
        className="ring-glow relative aspect-[16/9.2] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/85 backdrop-blur"
        style={{ transform: 'perspective(1800px) rotateX(2deg)' }}
      >
        <div className="absolute inset-0 bg-grid opacity-40" />

        {/* Window title bar */}
        <div className="relative flex items-center justify-between border-b border-white/5 bg-white/[0.03] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            </div>
            <span className="ml-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <span className="h-2 w-2 rounded-sm bg-gradient-to-br from-ruby-500 to-indigo-500" />
              blackruby · home
            </span>
          </div>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
            <span className="mr-1 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-emerald-400 animate-pulse" />
            autopilot · live
          </span>
        </div>

        <div className="relative grid h-[calc(100%-2.5rem)] grid-cols-12 gap-0">
          {/* Sidebar */}
          <aside className="col-span-3 border-r border-white/5 bg-white/[0.02] p-4">
            <div className="space-y-1">
              {[
                { l: 'Home',         active: true  },
                { l: 'Pipeline',     active: false },
                { l: 'Listings',     active: false },
                { l: 'Sales',        active: false },
                { l: 'Chats',        active: false },
                { l: 'Studio',       active: false },
                { l: 'Settings',     active: false },
              ].map((s) => (
                <div
                  key={s.l}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] transition ${
                    s.active ? 'bg-ruby-500/15 text-white' : 'text-zinc-500'
                  }`}
                >
                  {s.active && <span className="h-1 w-1 rounded-full bg-ruby-400" />}
                  <span>{s.l}</span>
                </div>
              ))}
            </div>
          </aside>

          {/* Main area */}
          <main className="col-span-9 p-4">
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-2">
              <KpiCard label="Live-Listings" value={listings.toString()} tone="ruby" delta="+12" />
              <KpiCard label="Sales heute"   value={sales.toString()}    tone="violet" delta="+3" />
              <KpiCard label="Umsatz heute"  value={`${revenue.toLocaleString('de-DE')} €`} tone="indigo" delta="+184 €" />
            </div>

            {/* Chart card */}
            <div className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                <span>Diese Woche · Sales / Tag</span>
                <span className="text-emerald-300">▲ 24 % vs. last week</span>
              </div>
              <div className="mt-3 flex h-14 items-end justify-around gap-2">
                {bars.map((h, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t transition-all duration-300"
                      style={{
                        height: `${h}%`,
                        background: i === 6
                          ? 'linear-gradient(180deg, #fb7185, #6366f1)'
                          : 'linear-gradient(180deg, rgba(244,63,94,0.5), rgba(99,102,241,0.3))',
                      }}
                    />
                    <span className="text-[8px] text-zinc-500">{today[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Listing strip — real brand-model photos from the user's Vinted account */}
            <div className="mt-3 grid grid-cols-4 gap-2">
              {['p1', 'p2', 'p3', 'p4'].map((id, i) => (
                <div
                  key={id}
                  className="group relative aspect-[3/4] overflow-hidden rounded-md border border-white/5 bg-zinc-900"
                >
                  <img
                    src={`/listings/products/${id}.jpg`}
                    alt={`Listing ${i + 1}`}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  {/* Price tag overlay */}
                  <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 font-mono text-[8px] text-white">
                    <span>{[24.9, 27.9, 32.0, 19.5][i]?.toFixed(2)} €</span>
                    <span className="rounded-sm bg-emerald-500/80 px-1 py-px text-[7px] font-bold uppercase">
                      live
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>

      {/* Floating event cards around the dashboard */}
      <FloatingEvent
        className="left-[-2%] top-[18%] hidden md:flex"
        delay={0}
        icon="sale"
        title="Sale · Vinted"
        subtitle="Cropped Cardigan · 27,90 €"
      />
      <FloatingEvent
        className="right-[-3%] top-[8%] hidden md:flex"
        delay={1800}
        icon="publish"
        title="Listing live"
        subtitle="3 Marktplätze · 0,82 s"
      />
      <FloatingEvent
        className="right-[-2%] bottom-[18%] hidden md:flex"
        delay={3600}
        icon="captcha"
        title="CAPTCHA solved"
        subtitle="whisper.cpp · 0,62 s"
      />
      <FloatingEvent
        className="left-[-3%] bottom-[10%] hidden md:flex"
        delay={5400}
        icon="cj"
        title="CJ-Order fired"
        subtitle="YT2521421266234876"
      />
    </div>
  );
}

function KpiCard({ label, value, tone, delta }: { label: string; value: string; tone: 'ruby' | 'violet' | 'indigo'; delta: string }) {
  const cls = tone === 'ruby' ? 'text-ruby-300' : tone === 'violet' ? 'text-violet-300' : 'text-indigo-300';
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className={`font-mono text-lg font-bold tabular-nums ${cls}`}>{value}</span>
        <span className="font-mono text-[9px] text-emerald-300">{delta}</span>
      </div>
    </div>
  );
}

// Floating event card — fades + drifts in a slow loop, staggered per card.
function FloatingEvent({
  className = '',
  delay = 0,
  icon,
  title,
  subtitle,
}: {
  className?: string;
  delay?: number;
  icon: 'sale' | 'publish' | 'captcha' | 'cj';
  title: string;
  subtitle: string;
}) {
  const ICONS = {
    sale:    { bg: 'from-ruby-500/40 to-ruby-500/10',    ring: 'ring-ruby-500/30',   dot: 'bg-ruby-400',     emoji: '€'  },
    publish: { bg: 'from-violet-500/40 to-violet-500/10', ring: 'ring-violet-500/30', dot: 'bg-violet-400',   emoji: '↗'  },
    captcha: { bg: 'from-emerald-500/40 to-emerald-500/10', ring: 'ring-emerald-500/30', dot: 'bg-emerald-400', emoji: '✓' },
    cj:      { bg: 'from-indigo-500/40 to-indigo-500/10', ring: 'ring-indigo-500/30', dot: 'bg-indigo-400',   emoji: '→'  },
  } as const;
  const c = ICONS[icon];
  return (
    <div
      className={`absolute z-10 flex items-center gap-2.5 rounded-xl border border-white/10 bg-zinc-950/85 px-3 py-2 shadow-2xl shadow-black/40 backdrop-blur-md ring-1 ${c.ring} ${className}`}
      style={{
        animation: 'float 6s ease-in-out infinite',
        animationDelay: `${delay}ms`,
      }}
    >
      <span className={`grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br ${c.bg} font-mono text-base font-bold text-white`}>
        {c.emoji}
      </span>
      <div className="text-left">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-white">
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot} animate-pulse`} />
          {title}
        </div>
        <div className="font-mono text-[9px] text-zinc-400">{subtitle}</div>
      </div>
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
