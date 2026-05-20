import { useState } from 'react';
import { Check, Sparkles, ArrowRight, Shield } from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';

interface Tier {
  id: 'starter' | 'hustler' | 'lifetime';
  name: string;
  tagline: string;
  monthly: number;
  yearly: number;
  lifetime?: number;
  featured?: boolean;
  features: { label: string; highlight?: boolean }[];
}

const TIERS: Tier[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Der Einstieg in den autonomen Resell.',
    monthly: 49,
    yearly: 490,
    features: [
      { label: 'Vinted + Kleinanzeigen + 1 weitere Plattform' },
      { label: 'Bis 200 Listings/Tag' },
      { label: 'CJ Dropshipping Integration' },
      { label: 'KI-Listing-Generation (Gemini Free-Tier)' },
      { label: 'E-Mail-Support (48 h)' },
      { label: 'Auto-Updates inklusive' },
    ],
  },
  {
    id: 'hustler',
    name: 'Hustler',
    tagline: 'Für ernsthafte Reseller. Volle Power.',
    monthly: 129,
    yearly: 1290,
    featured: true,
    features: [
      { label: 'Alle 21 Marktplätze', highlight: true },
      { label: 'Bis 1.000 Listings/Tag', highlight: true },
      { label: 'Auto-Repricer + 24h Re-Lister' },
      { label: 'Chat-Autopilot mit LLM-Drafts' },
      { label: 'Multi-Account Support' },
      { label: 'CAPTCHA: Whisper + 2captcha-Fallback' },
      { label: 'Priority Support (12 h)' },
      { label: 'Beta-Features Early-Access' },
    ],
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    tagline: 'Einmal kaufen. Für immer behalten.',
    monthly: 0,
    yearly: 0,
    lifetime: 1499,
    features: [
      { label: 'Alles aus Hustler', highlight: true },
      { label: 'Lebenslange Lizenz' },
      { label: 'Updates auf Lebenszeit' },
      { label: 'White-Glove Onboarding (1 h Setup-Call)' },
      { label: 'Private Discord-Community' },
      { label: 'Eigene Plattform-Wünsche bekommen Priority' },
    ],
  },
];

export function PricingPage() {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

  async function checkout(tier: Tier['id']) {
    const cadence = tier === 'lifetime' ? 'lifetime' : billing;
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, cadence }),
      });
      const data = await r.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Checkout-URL nicht erhalten. Bitte später erneut versuchen.');
      }
    } catch (e) {
      alert('Checkout fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div className="min-h-screen">
      <Nav />

      <section className="py-20">
        <div className="container-narrow">
          <div className="mx-auto max-w-3xl text-center">
            <span className="eyebrow">
              <Sparkles size={12} /> Faire Preise
            </span>
            <h1 className="h-display mt-6">
              Wähle deinen <span className="gradient-text">Plan.</span>
            </h1>
            <p className="mt-5 text-lg text-zinc-400">
              7 Tage Geld-zurück-Garantie. Sichere Zahlung über Stripe. Lizenz-Key per Mail
              direkt nach Kauf — fertig in 30 Sekunden.
            </p>
          </div>

          <div className="mt-12 flex justify-center">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
              {(['monthly', 'yearly'] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBilling(b)}
                  className={`relative rounded-full px-5 py-2 text-sm font-semibold transition ${
                    billing === b ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {b === 'monthly' ? 'Monatlich' : 'Jährlich'}
                  {b === 'yearly' && (
                    <span className="ml-2 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      –17%
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {TIERS.map((t) => {
              const price = t.lifetime ?? (billing === 'monthly' ? t.monthly : t.yearly);
              const cadence = t.lifetime
                ? 'einmalig'
                : billing === 'monthly'
                ? '/Monat'
                : '/Jahr';
              return (
                <div key={t.id} className="card-pricing" data-featured={t.featured ? 'true' : 'false'}>
                  {t.featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-ruby-500 to-indigo-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                      Empfehlung
                    </span>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-zinc-400">{t.name}</div>
                    <p className="mt-1 text-xs text-zinc-500">{t.tagline}</p>
                    <div className="mt-5 flex items-baseline gap-2">
                      <span className="font-display text-5xl font-extrabold text-white">
                        {price.toLocaleString('de-DE')} €
                      </span>
                      <span className="text-sm text-zinc-500">{cadence}</span>
                    </div>
                    {billing === 'yearly' && !t.lifetime && (
                      <p className="mt-1 text-xs text-emerald-400">
                        ~{Math.round((t.yearly / 12) * 10) / 10} €/Monat — du sparst {t.monthly * 12 - t.yearly} €
                      </p>
                    )}
                  </div>

                  <ul className="space-y-2.5 border-t border-white/5 pt-5">
                    {t.features.map((f) => (
                      <li key={f.label} className="flex items-start gap-2.5 text-sm">
                        <Check size={15} className={`mt-0.5 shrink-0 ${f.highlight ? 'text-ruby-300' : 'text-emerald-400'}`} />
                        <span className={f.highlight ? 'font-semibold text-white' : 'text-zinc-300'}>{f.label}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => void checkout(t.id)}
                    className={t.featured ? 'btn-primary w-full justify-center' : 'btn-ghost w-full justify-center'}
                  >
                    {t.id === 'lifetime' ? 'Lifetime kaufen' : 'Plan wählen'}
                    <ArrowRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-10 flex flex-col items-center gap-2 text-sm text-zinc-500">
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-emerald-400" />
              <span>7 Tage Geld-zurück-Garantie. Keine Fragen.</span>
            </div>
            <div className="text-xs">Sichere Zahlung über Stripe. SEPA, Kreditkarte, Apple Pay, Google Pay.</div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
