// ──────────────────────────────────────────────────────────────────────────────
// ListingsShowcase — iPhone-Mockup das echte Vinted-Screens durchrotiert.
//
// Zeigt dem Visitor wie ein fertiges Inserat aus dem Blackruby-Pipeline auf
// Vinted aussieht. Drei Screens:
//   1. Listing-Detail (großes Foto, Preis, "Pushen" Button)
//   2. Profile-Grid (verkaufte Items + Ansichten)
//   3. Foto-Lightbox (Vollbild)
//
// Auto-rotate alle 5 s, pauseert wenn User hovert oder einen Tab clickt.
// Klickbare Dots + Tab-Labels für manuelle Navigation.
//
// Bilder erwartet unter /listings/1.jpg, /listings/2.jpg, /listings/3.jpg
// im public-Folder.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Eye, Heart, ChevronLeft, ChevronRight } from 'lucide-react';

interface Slide {
  id: string;
  src: string;
  alt: string;
  badge: string;
  caption: string;
  stat: { icon: typeof Eye; label: string; value: string }[];
}

const SLIDES: Slide[] = [
  {
    id: 'detail',
    src: '/listings/1.jpg',
    alt: 'Listing-Detail mit Mirror-Selfie',
    badge: 'Listing live in 3 Klicks',
    caption: 'KI-Foto, KI-Beschreibung, KI-Preis. Du machst nichts.',
    stat: [
      { icon: Eye,   label: 'Ansichten / 24 h', value: '380+' },
      { icon: Heart, label: 'Favoriten',        value: '24' },
    ],
  },
  {
    id: 'profile',
    src: '/listings/2.jpg',
    alt: 'Profile mit verkauften Listings',
    badge: '4 von 12 verkauft',
    caption: 'Wenn ein Listing geht, bestellt Blackruby automatisch bei CJ.',
    stat: [
      { icon: Eye,   label: 'Sales-Quote', value: '33 %' },
      { icon: Heart, label: 'Avg. Marge',  value: '€11,40' },
    ],
  },
  {
    id: 'lightbox',
    src: '/listings/3.jpg',
    alt: 'Foto-Lightbox in voller Größe',
    badge: 'Konsistente Brand-Optik',
    caption: 'Gleiches Model, gleiche Wohnung — wirkt wie eine echte Privatperson.',
    stat: [
      { icon: Eye,   label: 'Bann-Risiko',  value: '<1 %' },
      { icon: Heart, label: 'Trust-Score',  value: 'A+' },
    ],
  },
];

const ROTATE_MS = 5_000;

export function ListingsShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (paused) return;
    intervalRef.current = window.setInterval(() => {
      setActive((i) => (i + 1) % SLIDES.length);
    }, ROTATE_MS);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [paused]);

  const slide = SLIDES[active]!;

  function go(idx: number) {
    setActive((idx + SLIDES.length) % SLIDES.length);
    setPaused(true);
    // Resume auto-rotate after 12 s of inactivity.
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    window.setTimeout(() => setPaused(false), 12_000);
  }

  return (
    <section className="relative py-24 sm:py-28">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-40" />

      <div className="container-narrow">
        <div className="mb-14 text-center">
          <span className="eyebrow"><Sparkles size={12} /> So sieht's bei dir aus</span>
          <h2 className="h-display mt-5">
            Auf Vinted{' '}
            <span className="gradient-text">in 30 Sekunden live.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
            Foto aus dem KI-Studio, Beschreibung vom LLM, Preis vom Repricer.
            Käufer sehen ein authentisches Mirror-Selfie aus dem Kleiderschrank — nicht Stock-Bilder vom Dropshipper.
          </p>
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-[1fr_auto_1fr]">
          {/* Left: caption + dots */}
          <div className="order-2 space-y-6 lg:order-1 lg:text-right">
            <div className="inline-flex items-center gap-2 rounded-full border border-ruby-500/30 bg-ruby-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ruby-200">
              <span className="h-1.5 w-1.5 rounded-full bg-ruby-400" />
              {slide.badge}
            </div>
            <p className="text-2xl font-bold leading-snug text-white sm:text-3xl">{slide.caption}</p>

            <div className="grid grid-cols-2 gap-3 lg:justify-items-end">
              {slide.stat.map((s) => {
                const Icon = s.icon;
                return (
                  <div
                    key={s.label}
                    className="w-full max-w-[180px] rounded-xl border border-white/10 bg-white/[0.02] p-3 backdrop-blur"
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <Icon size={11} />
                      {s.label}
                    </div>
                    <div className="mt-1 tabular text-2xl font-bold text-white">{s.value}</div>
                  </div>
                );
              })}
            </div>

            {/* Tab nav */}
            <div className="flex items-center gap-2 lg:justify-end">
              {SLIDES.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Screen ${i + 1}: ${s.alt}`}
                  className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    i === active
                      ? 'border-ruby-500/50 bg-ruby-500/15 text-white'
                      : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition ${
                      i === active ? 'bg-ruby-400' : 'bg-zinc-600 group-hover:bg-zinc-400'
                    }`}
                  />
                  {i + 1} / {SLIDES.length}
                </button>
              ))}
            </div>
          </div>

          {/* Center: iPhone mockup */}
          <div
            className="order-1 mx-auto lg:order-2"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <IphoneMockup>
              <div className="relative h-full w-full overflow-hidden bg-zinc-100">
                {SLIDES.map((s, i) => (
                  <img
                    key={s.id}
                    src={s.src}
                    alt={s.alt}
                    loading={i === 0 ? 'eager' : 'lazy'}
                    className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
                      i === active ? 'opacity-100' : 'opacity-0'
                    }`}
                    onError={(e) => {
                      // Placeholder if user hasn't dropped files yet.
                      const t = e.target as HTMLImageElement;
                      t.style.display = 'none';
                      const parent = t.parentElement;
                      if (parent && !parent.querySelector(`.placeholder-${i}`)) {
                        const el = document.createElement('div');
                        el.className = `placeholder-${i} absolute inset-0 grid place-items-center bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-500 text-xs px-6 text-center`;
                        el.textContent = `Lege "${s.src}" in marketing/public${s.src} ab`;
                        parent.appendChild(el);
                      }
                    }}
                  />
                ))}
              </div>
            </IphoneMockup>

            {/* Prev / Next arrows below phone */}
            <div className="mt-6 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => go(active - 1)}
                aria-label="Vorheriger Screen"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-2">
                {SLIDES.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Zu Screen ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === active ? 'w-8 bg-ruby-400' : 'w-1.5 bg-zinc-700 hover:bg-zinc-500'
                    }`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => go(active + 1)}
                aria-label="Nächster Screen"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Right: empty for layout symmetry on desktop */}
          <div className="hidden lg:block lg:order-3" />
        </div>
      </div>
    </section>
  );
}

// ── iPhone-Mockup ────────────────────────────────────────────────────────────
// Minimalistischer Frame im Apple-Design — kein Photoshop-Mockup, sondern CSS.
// Aspect ratio 9:19.5 (iPhone 14/15 Pro). Innen wird beliebig befüllt.
function IphoneMockup({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative" style={{ width: 320 }}>
      {/* Backlight glow */}
      <div className="absolute -inset-8 -z-10 rounded-[60px] bg-gradient-to-br from-ruby-500/20 via-violet-500/15 to-indigo-500/20 blur-3xl opacity-70" />

      {/* Outer frame */}
      <div
        className="relative rounded-[48px] bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-2 shadow-2xl shadow-black/60"
        style={{
          aspectRatio: '9 / 19.5',
          boxShadow: '0 25px 60px -15px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 -3px 8px rgba(0,0,0,0.5)',
        }}
      >
        {/* Inner bezel */}
        <div className="relative h-full w-full overflow-hidden rounded-[40px] bg-black">
          {/* Dynamic Island */}
          <div className="absolute left-1/2 top-2 z-20 h-7 w-24 -translate-x-1/2 rounded-full bg-black ring-1 ring-zinc-800" />

          {/* Status bar */}
          <div className="absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between px-7 text-[10px] font-semibold text-white">
            <span>9:41</span>
            <span className="flex items-center gap-1.5">
              <span>•••</span>
              <span>5G</span>
              <span className="ml-1 inline-block h-2.5 w-4 rounded-sm border border-white/80">
                <span className="block h-full w-2/3 bg-white/80" />
              </span>
            </span>
          </div>

          {/* Screen content */}
          <div className="absolute inset-0 pt-10">{children}</div>

          {/* Home indicator */}
          <div className="absolute bottom-1.5 left-1/2 z-20 h-1 w-32 -translate-x-1/2 rounded-full bg-white/40" />
        </div>
      </div>
    </div>
  );
}
