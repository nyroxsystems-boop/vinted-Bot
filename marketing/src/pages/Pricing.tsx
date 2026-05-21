import { Check, Sparkles, ArrowRight, Shield, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { useAuth } from '../lib/auth';

interface Tier {
  id: 'starter' | 'hustler';
  name: string;
  tagline: string;
  monthly: number;
  featured?: boolean;
  features: { label: string; highlight?: boolean }[];
}

const TIERS: Tier[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Der Einstieg in den autonomen Resell.',
    monthly: 99,
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
    monthly: 199,
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
];

export function PricingPage() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();

  async function checkout(tier: Tier['id']) {
    // Gate behind login so every purchase is bound to a user account and
    // the license is immediately visible in the member-space after payment.
    if (!ready) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent('/pricing')}`);
      return;
    }
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, cadence: 'monthly' }),
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
              direkt nach Kauf — fertig in 30 Sekunden. Monatlich kündbar.
            </p>
          </div>

          <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
            {TIERS.map((t) => (
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
                      {t.monthly.toLocaleString('de-DE')} €
                    </span>
                    <span className="text-sm text-zinc-500">/Monat</span>
                  </div>
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
                  {ready && !user ? (
                    <>
                      <Lock size={14} /> Anmelden &amp; kaufen
                    </>
                  ) : (
                    <>
                      Plan wählen
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>
            ))}
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
