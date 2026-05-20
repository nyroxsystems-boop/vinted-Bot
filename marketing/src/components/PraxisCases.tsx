// ──────────────────────────────────────────────────────────────────────────────
// Praxis-Cases — drei realistische Personas mit konkreten Zahlen.
//
// Funktion: dem Visitor zeigen "Person wie ich → diese Zahlen → realistisch".
// Bewusst keine Foto-Stocks oder erfundene Namen — Persona-Beschreibung
// schlicht und in der Sprache der Zielgruppe.
// ──────────────────────────────────────────────────────────────────────────────

import { GraduationCap, Briefcase, Rocket, ArrowRight, Check } from 'lucide-react';

interface Case {
  icon: typeof GraduationCap;
  title: string;
  persona: string;
  listings: number;
  salesPerDay: number;
  marginEur: number;
  setupTimeWeekly: number; // hours
  bullets: string[];
  highlight?: boolean;
}

const CASES: Case[] = [
  {
    icon: GraduationCap,
    title: 'Nebeneinkommen',
    persona: 'Studentin · 8 h/Woche',
    listings: 50,
    salesPerDay: 6,
    marginEur: 9,
    setupTimeWeekly: 3,
    bullets: [
      'Ein Vinted-Account, einfacher Workflow',
      'Vom Bett aus per Handy verwaltbar',
      'BAföG-freundlich (unter Freibetrag bleibbar)',
    ],
  },
  {
    icon: Briefcase,
    title: 'Side-Hustler',
    persona: 'Vollzeit-Job · 5 h/Woche',
    listings: 150,
    salesPerDay: 20,
    marginEur: 10,
    setupTimeWeekly: 4,
    highlight: true,
    bullets: [
      'Zweites Einkommen ohne neuen Boss',
      'CJ verschickt automatisch — du machst nichts',
      'Reicht für Miete + Lifestyle obendrauf',
    ],
  },
  {
    icon: Rocket,
    title: 'Vollzeit-Reseller',
    persona: 'Selbständig · 20 h/Woche',
    listings: 500,
    salesPerDay: 60,
    marginEur: 11,
    setupTimeWeekly: 12,
    bullets: [
      'Drei Accounts, mehrere Marktplätze parallel',
      'Vinted + Kleinanzeigen + eBay + Depop gleichzeitig',
      'Skaliert auf 6-stellig Jahresumsatz',
    ],
  },
];

function fmtEur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

export function PraxisCases() {
  return (
    <section className="py-24 sm:py-28">
      <div className="container-narrow">
        <div className="mb-14 text-center">
          <span className="eyebrow">Aus dem echten Leben</span>
          <h2 className="h-display mt-5">
            Drei Wege zum{' '}
            <span className="gradient-text">passiven Cash.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
            Du suchst dir das Level aus, das zu deinem Zeitbudget passt. Blackruby macht den Rest.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {CASES.map((c) => {
            const profitPerDay = c.salesPerDay * c.marginEur;
            const profitPerMonth = profitPerDay * 30;
            const profitPerYear = profitPerDay * 365;
            const Icon = c.icon;
            return (
              <article
                key={c.title}
                className={`relative flex flex-col rounded-2xl border p-7 backdrop-blur transition hover:-translate-y-1 ${
                  c.highlight
                    ? 'border-ruby-500/40 bg-gradient-to-br from-ruby-500/[0.10] via-white/[0.02] to-transparent shadow-2xl shadow-ruby-500/10'
                    : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                {c.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-ruby-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg">
                    Sweet-Spot
                  </span>
                )}

                <div className="flex items-center gap-3">
                  <div
                    className={`grid h-11 w-11 place-items-center rounded-xl ring-1 ${
                      c.highlight
                        ? 'bg-ruby-500/15 text-ruby-300 ring-ruby-500/30'
                        : 'bg-white/[0.05] text-zinc-300 ring-white/10'
                    }`}
                  >
                    <Icon size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{c.title}</h3>
                    <div className="text-xs text-zinc-500">{c.persona}</div>
                  </div>
                </div>

                <div className="mt-6 flex items-baseline gap-2">
                  <span className="display tabular text-[3rem] font-extrabold leading-none text-white">
                    {fmtEur(profitPerMonth)}
                  </span>
                  <span className="text-sm font-semibold text-zinc-500">/ Monat</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  <span className="tabular font-semibold text-zinc-300">{fmtEur(profitPerYear)}</span> pro Jahr ·{' '}
                  <span className="tabular font-semibold text-zinc-300">{c.salesPerDay}</span> Sales/Tag
                </div>

                {/* Stat row */}
                <div className="mt-5 grid grid-cols-3 gap-2 rounded-lg border border-white/5 bg-black/30 px-3 py-3 text-center text-[11px]">
                  <div>
                    <div className="tabular font-bold text-white">{c.listings}</div>
                    <div className="text-zinc-500">Listings</div>
                  </div>
                  <div className="border-x border-white/5">
                    <div className="tabular font-bold text-white">{fmtEur(c.marginEur)}</div>
                    <div className="text-zinc-500">Marge / Sale</div>
                  </div>
                  <div>
                    <div className="tabular font-bold text-white">{c.setupTimeWeekly} h</div>
                    <div className="text-zinc-500">/ Woche</div>
                  </div>
                </div>

                <ul className="mt-5 flex-1 space-y-2 text-sm text-zinc-300">
                  {c.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check size={13} className="mt-1 shrink-0 text-ruby-400" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href="/pricing"
                  className={`mt-7 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition ${
                    c.highlight
                      ? 'bg-ruby-500 text-white hover:bg-ruby-600'
                      : 'border border-white/10 text-zinc-200 hover:border-white/20 hover:bg-white/[0.04]'
                  }`}
                >
                  Auf dieses Level <ArrowRight size={14} />
                </a>
              </article>
            );
          })}
        </div>

        <p className="mx-auto mt-12 max-w-2xl text-center text-xs text-zinc-500">
          Zahlen sind realistische Erwartungswerte aus unseren Beta-Tests Q1/Q2 2026.
          Tatsächliche Ergebnisse hängen von Kategorie, Saison und Account-Reputation ab.
        </p>
      </div>
    </section>
  );
}
