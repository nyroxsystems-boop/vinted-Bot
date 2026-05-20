import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Zap,
  ShieldCheck,
  Globe,
  Bot,
  TrendingUp,
  Lock,
  Cpu,
  Layers,
  Sparkles,
  Apple,
  MonitorDown,
} from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { ProfitCalculator } from '../components/ProfitCalculator';
import { PraxisCases } from '../components/PraxisCases';
import { ListingsShowcase } from '../components/ListingsShowcase';

const MARKETPLACES = [
  'Vinted', 'Kleinanzeigen', 'eBay-DE', 'eBay-UK', 'Depop', 'Mercari',
  'Wallapop', 'Etsy', 'Grailed', 'FB Marketplace', 'Vestiaire',
  'Whatnot', 'Shpock', 'Poshmark', 'TradeMe', 'Rebelle', 'Vide-Dressing',
  'Momox', 'Sellpy', 'Kleiderkreisel', 'Mädchenflohmarkt',
];

const FEATURES = [
  {
    icon: Bot,
    title: 'Autopilot-Listings',
    body: 'Foto rein, KI generiert Titel, Beschreibung, Tags und Preis — pro Plattform optimiert. Vinted Gen-Z, eBay formal, KA neutral. Alles offline mit lokalem LLM-Provider.',
  },
  {
    icon: Layers,
    title: '21 Marktplätze, ein Dashboard',
    body: 'Crosslisting auf Vinted, Kleinanzeigen, eBay, Depop, Mercari, Wallapop, Etsy, Grailed und 13 weiteren. Verkauf auf einem Markt = automatische Deaktivierung überall sonst.',
  },
  {
    icon: TrendingUp,
    title: 'Auto-Repricer & Re-Lister',
    body: '24 h nach jedem Verkauf wird automatisch nachgelistet — mit Foto-Shuffle, Preis-Jitter und Titel-Variation, um Bann-Trigger zu umgehen.',
  },
  {
    icon: Zap,
    title: 'CJ Dropshipping integriert',
    body: 'Bei jedem Verkauf bestellt Blackruby automatisch bei CJ — direkt an deinen Kunden, mit Tracking-Sync. Du fasst nie ein Paket an.',
  },
  {
    icon: ShieldCheck,
    title: 'CAPTCHA-resistent',
    body: 'Whisper-basiertes Audio-Solving (0 €), Human-Behavior-Jitter und 3-Layer-Strategie. Bann-Rate praktisch null bei gewärmten Sessions.',
  },
  {
    icon: Lock,
    title: '100% lokal — keine Cloud',
    body: 'Daten, Cookies, API-Keys leben in deiner SQLite-DB auf deinem Rechner. Kein SaaS-Lock-in, kein Datenleck-Risiko, kein Monatsabo für Cloud-Compute.',
  },
];

const STATS = [
  { value: '200 €', label: 'Gewinn / Tag (typisch)' },
  { value: '20', label: 'Sales / Tag (machbar)' },
  { value: '21', label: 'Marktplätze' },
  { value: '< 1%', label: 'Bann-Rate' },
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
      <ListingsShowcase />
      <LogoStrip />
      <Stats />
      <ProfitCalculator />
      <PraxisCases />
      <FeatureGrid />
      <HowItWorks />
      <PricingPreview />
      <FaqSection />
      <CtaBanner />
      <Footer />
    </div>
  );
}

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
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <div className="relative">
      <div className="absolute inset-0 -m-2 rounded-3xl bg-gradient-to-br from-ruby-500/30 via-violet-500/20 to-indigo-500/30 blur-2xl opacity-60" />
      <div className="ring-glow relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 backdrop-blur">
        <div className="flex items-center gap-1.5 border-b border-white/5 bg-white/[0.02] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="ml-3 font-mono text-[11px] text-zinc-500">blackruby — hustle engine</span>
        </div>
        <div className="grid grid-cols-12 gap-0">
          <aside className="col-span-3 border-r border-white/5 bg-zinc-950/60 p-4 text-xs">
            <div className="mb-4 flex items-center gap-2">
              <span className="h-7 w-7 rounded-md bg-gradient-to-br from-ruby-500 to-indigo-500" />
              <span className="font-semibold text-white">Blackruby</span>
            </div>
            <div className="space-y-1">
              {['Home', 'Listings', 'Verkauf', 'Einstellungen'].map((l, i) => (
                <div
                  key={l}
                  className={`rounded-md px-2.5 py-1.5 ${
                    i === 0 ? 'bg-white/[0.06] text-white' : 'text-zinc-500'
                  }`}
                >
                  {l}
                </div>
              ))}
            </div>
          </aside>
          <main className="col-span-9 p-5 text-xs">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold text-white">Home</span>
              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                Auto-Publisher aktiv
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <PreviewKpi label="Live insgesamt" value="312" color="text-emerald-300" />
              <PreviewKpi label="Heute published" value="68 / 80" color="text-indigo-300" />
              <PreviewKpi label="Sales heute" value="22" color="text-ruby-300" />
            </div>
            <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.02] p-4">
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
                <span>Approved Listings</span>
                <span>Ready to ship</span>
              </div>
              <div className="text-3xl font-bold text-white">104</div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-ruby-500 to-indigo-500 px-4 py-2 text-[11px] font-bold text-white">
                Alles listen jetzt →
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function PreviewKpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

function LogoStrip() {
  return (
    <section className="border-y border-white/5 bg-white/[0.01] py-10">
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
    </section>
  );
}

function Stats() {
  return (
    <section className="py-20">
      <div className="container-narrow grid grid-cols-2 gap-6 md:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="card-glass text-center">
            <div className="gradient-text font-display text-5xl font-extrabold tracking-tight">{s.value}</div>
            <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureGrid() {
  return (
    <section id="features" className="py-24">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Features</span>
          <h2 className="h-section mt-5">Alles was du brauchst, damit der Hustle skaliert.</h2>
          <p className="mt-4 text-zinc-400">
            Sechs Säulen, eine App. Lokal, signiert, Auto-Update. Keine versteckten Cloud-Kosten.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card-glass group transition hover:border-white/20">
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-ruby-500/20 to-indigo-500/20 text-ruby-300 ring-1 ring-ruby-500/20">
                <f.icon size={20} />
              </div>
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

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
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">In 4 Schritten live</span>
          <h2 className="h-section mt-5">Von Download bis erstem Sale: ein Nachmittag.</h2>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.num} className="card-glass relative">
              <div className="absolute right-5 top-5 font-mono text-3xl font-bold text-white/10">{s.num}</div>
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-ruby-500 to-indigo-500 text-sm font-bold text-white">
                {i + 1}
              </div>
              <h3 className="text-base font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingPreview() {
  return (
    <section id="pricing-preview" className="py-24">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Preise</span>
          <h2 className="h-section mt-5">Einmal kaufen. Lebenslang nutzen.</h2>
          <p className="mt-4 text-zinc-400">
            Drei Tiers. Kein Abo erzwungen. Lifetime-Lizenzen verfügbar.
            Auto-Updates inklusive.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          <PricingTeaser
            name="Starter"
            price="49 €"
            cadence="/Monat"
            features={['Vinted + KA + 1 weitere', 'Bis 200 Listings/Tag', 'CJ-Integration', 'E-Mail-Support']}
          />
          <PricingTeaser
            name="Hustler"
            price="129 €"
            cadence="/Monat"
            featured
            features={['Alle 21 Marktplätze', 'Bis 1.000 Listings/Tag', 'Auto-Repricer + Re-Lister', 'Chat-Autopilot', 'Priority-Support']}
          />
          <PricingTeaser
            name="Lifetime"
            price="1.499 €"
            cadence="einmalig"
            features={['Alles aus Hustler', 'Lebenslange Lizenz', 'Beta-Features zuerst', 'White-Glove Onboarding']}
          />
        </div>

        <div className="mt-10 text-center">
          <Link to="/pricing" className="btn-link">
            Alle Pläne im Vergleich <ArrowRight size={14} />
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

function FaqSection() {
  return (
    <section className="py-24">
      <div className="container-mid">
        <div className="text-center">
          <span className="eyebrow">FAQ</span>
          <h2 className="h-section mt-5">Häufig gestellte Fragen.</h2>
        </div>
        <div className="mt-12 space-y-3">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-5 transition hover:border-white/20 open:border-ruby-500/30 open:bg-ruby-500/[0.03]"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-semibold text-white">
                {item.q}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 transition group-open:rotate-45">
                  <Cpu size={14} className="hidden group-open:hidden" />
                  <span className="text-lg leading-none text-zinc-400">+</span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaBanner() {
  return (
    <section className="py-24">
      <div className="container-narrow">
        <div className="ring-glow relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-ruby-500/10 via-violet-500/10 to-indigo-500/10 p-10 text-center md:p-16">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
          <Globe size={48} className="relative mx-auto text-ruby-300 opacity-80" />
          <h2 className="h-section relative mt-6">
            Bereit den Hustle <span className="gradient-text">zu skalieren</span>?
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-zinc-400">
            21 Marktplätze. Ein Dashboard. Lifetime-Lizenz verfügbar.
            Updates auf Lebenszeit. Kein Cloud-Lock-in.
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
      </div>
    </section>
  );
}
