// FeatureShowcase — animated CGI demos of the 6 core features.
//
// Replaces the static FeatureGrid + screenshot-driven ListingsShowcase
// with self-running visualizations. Each panel pairs copy on one side
// with a continuously-animating SVG demo on the other; layouts alternate
// L/R for rhythm. No screenshots, no images — everything is rendered
// from React + SVG + Tailwind so it stays sharp at any DPI and adapts
// to the user's color tokens.
//
// Demos:
//   1. Model Studio       — picker tiles cycle, avatar silhouette
//                            assembles from the active swatches.
//   2. Scene Generation   — product center, 4 lifestyle scenes generate
//                            around it with a scan-shimmer.
//   3. Crosslisting       — one listing fans out to 21 marketplaces in
//                            an orbital sweep, checkmarks confirm.
//   4. Auto-Repricer      — price line wobbles, 24 h timer ticks, re-list
//                            flash on each cycle.
//   5. CJ Dropshipping    — sale → CJ → tracking → delivered, four
//                            stages light up sequentially.
//   6. Anti-Bann Stack    — audio waveform (CAPTCHA), human-jitter cursor
//                            trail, session-warmup pulse.

import { useEffect, useState } from 'react';
import {
  ShoppingBag,
  Truck,
  ScanLine,
  CheckCircle2,
  Sparkles,
  Layers,
  TrendingUp,
  Zap,
  ShieldCheck,
  User,
  Image as ImageIcon,
  Globe,
} from 'lucide-react';
import { Reveal } from './Reveal';

// ──────────────────────────────────────────────────────────────────────────────
// Marketplace list (kept here so the crosslisting demo is self-contained)
// ──────────────────────────────────────────────────────────────────────────────
const MARKETPLACES = [
  'Vinted', 'Kleinanzeigen', 'eBay-DE', 'eBay-UK', 'Depop', 'Mercari',
  'Wallapop', 'Etsy', 'Grailed', 'FB Marketplace', 'Vestiaire',
  'Whatnot', 'Shpock', 'Poshmark', 'TradeMe', 'Rebelle', 'Vide-Dressing',
  'Momox', 'Sellpy', 'Kleiderkreisel', 'Mädchenflohmarkt',
];

// ──────────────────────────────────────────────────────────────────────────────
// Shared panel chrome
// ──────────────────────────────────────────────────────────────────────────────
function Panel({
  eyebrow,
  title,
  body,
  visual,
  reverse,
}: {
  eyebrow: string;
  title: string;
  body: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <Reveal as="article" className="py-20 first:pt-0 last:pb-0">
      <div
        className={`container-narrow grid items-center gap-10 md:grid-cols-2 md:gap-16 ${
          reverse ? 'md:[&>*:first-child]:order-2' : ''
        }`}
      >
        <div className="space-y-5">
          <span className="eyebrow">{eyebrow}</span>
          <h3 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl" style={{ letterSpacing: '-0.02em' }}>
            {title}
          </h3>
          <p className="max-w-md text-zinc-400">{body}</p>
        </div>

        <div className="ring-glow relative aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/70 backdrop-blur">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
          {visual}
        </div>
      </div>
    </Reveal>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Model Studio
// ──────────────────────────────────────────────────────────────────────────────
function ModelStudioVisual() {
  // 11 pickers, each cycles through 3 swatches every ~1.2s on a stagger.
  const PICKERS = [
    { label: 'Ethnicity', swatches: ['#f3d6b8', '#d4a373', '#a87752'] },
    { label: 'Skin',      swatches: ['#f5e0c5', '#e2b88e', '#b48560'] },
    { label: 'Hair',      swatches: ['#1f1b18', '#7a4a2b', '#d4a373'] },
    { label: 'Eyes',      swatches: ['#3b6e8f', '#5b8b4a', '#7a4a2b'] },
    { label: 'Face',      swatches: ['#fda4af', '#f9a8d4', '#fb7185'] },
    { label: 'Body',      swatches: ['#a78bfa', '#818cf8', '#7c3aed'] },
    { label: 'Height',    swatches: ['#fb7185', '#f43f5e', '#be123c'] },
    { label: 'Age',       swatches: ['#fbbf24', '#f59e0b', '#b45309'] },
    { label: 'Makeup',    swatches: ['#fda4af', '#fb7185', '#9d174d'] },
    { label: 'Aesthetic', swatches: ['#818cf8', '#a78bfa', '#c4b5fd'] },
    { label: 'Mood',      swatches: ['#34d399', '#10b981', '#059669'] },
  ];

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1100);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-full w-full">
      <div className="grid h-full grid-cols-12 gap-3 p-5">
        <div className="col-span-7 grid grid-cols-3 gap-2 content-start">
          {PICKERS.map((p, i) => {
            const active = (tick + i) % p.swatches.length;
            return (
              <div
                key={p.label}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-2"
              >
                <div className="mb-1.5 text-[9px] uppercase tracking-wider text-zinc-500">
                  {p.label}
                </div>
                <div className="flex gap-1">
                  {p.swatches.map((c, j) => (
                    <span
                      key={c}
                      className="h-3 w-3 rounded-full transition-all duration-500"
                      style={{
                        background: c,
                        opacity: j === active ? 1 : 0.25,
                        transform: j === active ? 'scale(1.4)' : 'scale(1)',
                        boxShadow: j === active ? `0 0 8px ${c}` : 'none',
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="col-span-5 flex flex-col items-center justify-center">
          {/* Avatar silhouette — head + shoulders, "regenerating" pulse */}
          <div className="relative">
            <div className="absolute inset-0 -m-4 rounded-full bg-ruby-500/20 blur-xl animate-pulse-slow" />
            <svg viewBox="0 0 100 130" className="relative h-44 w-44">
              <defs>
                <linearGradient id="model-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#fb7185" />
                  <stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
              </defs>
              {/* Head */}
              <circle cx="50" cy="36" r="22" fill="url(#model-fill)" opacity="0.85" />
              {/* Shoulders */}
              <path
                d="M 12 130 Q 12 78 50 70 Q 88 78 88 130 Z"
                fill="url(#model-fill)"
                opacity="0.85"
              />
              {/* Hair accent */}
              <path
                d="M 28 30 Q 30 14 50 14 Q 70 14 72 30 Q 70 22 50 22 Q 30 22 28 30 Z"
                fill="#0a0a0c"
                opacity="0.6"
              />
              {/* Scan line */}
              <line
                x1="10" x2="90"
                y1={20 + (tick * 7) % 100}
                y2={20 + (tick * 7) % 100}
                stroke="#fda4af"
                strokeWidth="0.5"
                opacity="0.6"
              />
            </svg>
          </div>
          <div className="mt-3 text-[10px] uppercase tracking-wider text-zinc-500">
            Active Brand-Model
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Locked in
          </div>
        </div>
      </div>

      {/* Title bar */}
      <div className="absolute left-4 top-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <User size={11} /> Model Studio
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. Scene Generation
// ──────────────────────────────────────────────────────────────────────────────
function SceneGenVisual() {
  // 4 scene cells, each generates one at a time with a shimmer.
  const SCENES = [
    { id: 'mirror',  label: 'Mirror Selfie', from: '#f43f5e', to: '#fb7185' },
    { id: 'cafe',    label: 'Café',          from: '#b45309', to: '#fbbf24' },
    { id: 'outdoor', label: 'Outdoor',       from: '#059669', to: '#34d399' },
    { id: 'studio',  label: 'Studio',        from: '#6366f1', to: '#a78bfa' },
  ];

  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % 4), 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-full w-full p-5">
      <div className="absolute left-4 top-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <ImageIcon size={11} /> Scene Generation · Gemini
      </div>

      <div className="grid h-full grid-cols-2 grid-rows-2 gap-2 pt-4">
        {SCENES.map((s, i) => {
          const isActive   = active === i;
          const isDone     = ((active - i + 4) % 4) > 0; // already generated this cycle
          return (
            <div
              key={s.id}
              className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
            >
              <div
                className="absolute inset-0 transition-opacity duration-700"
                style={{
                  background: `radial-gradient(circle at 50% 60%, ${s.from} 0%, ${s.to} 60%, transparent 100%)`,
                  opacity: isDone || isActive ? 0.5 : 0.1,
                }}
              />
              {/* Scan shimmer overlay while active */}
              {isActive && (
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.4s linear infinite',
                  }}
                />
              )}
              {/* Generated-photo mock: gradient bg + silhouette */}
              <svg viewBox="0 0 80 60" className="absolute inset-0 h-full w-full opacity-50">
                <ellipse cx="40" cy="25" rx="8" ry="8" fill="rgba(255,255,255,0.5)" />
                <path d="M 22 60 Q 22 38 40 36 Q 58 38 58 60 Z" fill="rgba(255,255,255,0.4)" />
              </svg>
              <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[9px]">
                <span className="font-mono uppercase tracking-wider text-white/80">
                  {s.label}
                </span>
                {isDone ? (
                  <CheckCircle2 size={11} className="text-emerald-300" />
                ) : isActive ? (
                  <span className="text-[8px] text-white/60">generating…</span>
                ) : (
                  <span className="text-[8px] text-white/30">queued</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Crosslisting orbit
// ──────────────────────────────────────────────────────────────────────────────
function CrosslistVisual() {
  // 21 marketplaces arranged in 2 orbits around the center listing.
  // Each orbit slot lights up in sequence to suggest the cross-publish sweep.
  const cx = 50, cy = 50;
  const r1 = 22, r2 = 38;
  const inner = MARKETPLACES.slice(0, 8);
  const outer = MARKETPLACES.slice(8);

  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % MARKETPLACES.length), 280);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-4 top-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <Layers size={11} /> Crosslist · 21 Marktplätze
      </div>

      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="orbit-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#fb7185" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Glow */}
        <circle cx={cx} cy={cy} r="35" fill="url(#orbit-glow)" />
        {/* Orbit rings */}
        <circle cx={cx} cy={cy} r={r1} stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" fill="none" />
        <circle cx={cx} cy={cy} r={r2} stroke="rgba(255,255,255,0.05)" strokeWidth="0.3" fill="none" />
        {/* Center listing */}
        <rect x={cx - 5} y={cy - 5} width="10" height="10" rx="2" fill="url(#center-fill)" />
        <defs>
          <linearGradient id="center-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#fb7185" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>

        {/* Inner orbit slots */}
        {inner.map((_, i) => {
          const angle = (i / inner.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * r1;
          const y = cy + Math.sin(angle) * r1;
          const lit = step >= i;
          return (
            <g key={`i-${i}`}>
              <line
                x1={cx} y1={cy} x2={x} y2={y}
                stroke={lit ? '#fb7185' : 'rgba(255,255,255,0.06)'}
                strokeWidth={lit ? '0.4' : '0.2'}
                opacity={lit ? 0.55 : 0.4}
              />
              <circle
                cx={x} cy={y}
                r={lit ? '1.8' : '1.2'}
                fill={lit ? '#fb7185' : 'rgba(255,255,255,0.18)'}
                style={{ transition: 'all 200ms ease-out' }}
              />
            </g>
          );
        })}

        {/* Outer orbit slots */}
        {outer.map((_, i) => {
          const idx = inner.length + i;
          const angle = (i / outer.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * r2;
          const y = cy + Math.sin(angle) * r2;
          const lit = step >= idx;
          return (
            <g key={`o-${i}`}>
              <line
                x1={cx} y1={cy} x2={x} y2={y}
                stroke={lit ? '#a78bfa' : 'rgba(255,255,255,0.04)'}
                strokeWidth={lit ? '0.3' : '0.15'}
                opacity={lit ? 0.4 : 0.3}
              />
              <circle
                cx={x} cy={y}
                r={lit ? '1.4' : '1'}
                fill={lit ? '#a78bfa' : 'rgba(255,255,255,0.15)'}
                style={{ transition: 'all 200ms ease-out' }}
              />
            </g>
          );
        })}
      </svg>

      {/* Marketplace badge floating text — currently being published */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-white/10 bg-zinc-950/80 px-3 py-1.5 text-[10px] font-mono backdrop-blur">
        <span className="text-zinc-500">publishing →</span>{' '}
        <span className="font-bold text-white">{MARKETPLACES[step]}</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. Auto-Repricer + Re-Lister
// ──────────────────────────────────────────────────────────────────────────────
function RepricerVisual() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 220);
    return () => clearInterval(id);
  }, []);

  // Build a wobbly price curve from a deterministic sin+noise based on tick.
  const POINTS = 36;
  const path = Array.from({ length: POINTS }, (_, i) => {
    const x = (i / (POINTS - 1)) * 90 + 5;
    const phase = (tick + i) * 0.18;
    const y = 50
      - Math.sin(phase) * 6
      - Math.sin(phase * 0.5) * 3
      + (((tick + i) * 7) % 11) * 0.4;
    return [x, y] as const;
  });
  const d = path.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
  const currentPrice = 27.9 - Math.sin(tick * 0.18) * 1.5 - ((tick * 7) % 11) * 0.1;

  // 24 h countdown loops, with a "Re-Lister fired!" flash at the bottom.
  const hourLeft = Math.max(0, 24 - Math.floor((tick % 60) * 0.4));
  const firing = hourLeft === 0;

  return (
    <div className="relative h-full w-full p-5">
      <div className="absolute left-4 top-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <TrendingUp size={11} /> Auto-Repricer · Re-Lister 24 h
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 text-center">
        <Kpi label="Live-Preis" value={`${currentPrice.toFixed(2)} €`} accent="ruby" />
        <Kpi label="Re-List in" value={`${hourLeft} h`} accent="indigo" />
        <Kpi label="Views / 24 h" value={`${380 + (tick * 13) % 80}`} accent="violet" />
      </div>

      <div className="mt-4 h-32 w-full overflow-hidden rounded-lg border border-white/5 bg-white/[0.02]">
        <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id="repricer-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"  stopColor="#fb7185" />
              <stop offset="60%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
            <linearGradient id="repricer-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="rgba(244, 63, 94, 0.3)" />
              <stop offset="100%" stopColor="rgba(244, 63, 94, 0)" />
            </linearGradient>
          </defs>
          <path d={`${d} L 95 50 L 5 50 Z`} fill="url(#repricer-fill)" />
          <path d={d} stroke="url(#repricer-line)" strokeWidth="0.8" fill="none" />
          {/* Live dot at end */}
          <circle cx={path[path.length - 1][0]} cy={path[path.length - 1][1]} r="1.2" fill="#fb7185">
            <animate attributeName="r" values="1.2;2.2;1.2" dur="1s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>

      <div
        className="mt-3 flex items-center justify-center gap-2 text-[10px] uppercase tracking-wider transition"
        style={{ color: firing ? '#34d399' : '#71717a' }}
      >
        {firing ? (
          <>
            <Zap size={12} className="animate-pulse" />
            Re-Lister fired · Foto-Shuffle · Preis-Jitter · Titel-Variation
          </>
        ) : (
          <>cooldown • next cycle</>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: 'ruby' | 'indigo' | 'violet' }) {
  const color = accent === 'ruby' ? 'text-ruby-300' : accent === 'indigo' ? 'text-indigo-300' : 'text-violet-300';
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-bold ${color}`}>{value}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. CJ Dropshipping flow
// ──────────────────────────────────────────────────────────────────────────────
function CjFlowVisual() {
  const STAGES = [
    { icon: ShoppingBag,   label: 'Sale',     hint: 'Vinted detects sale' },
    { icon: Sparkles,      label: 'CJ Order', hint: 'auto-placed via API' },
    { icon: Truck,         label: 'Shipping', hint: 'tracking nr. synced' },
    { icon: CheckCircle2,  label: 'Delivered', hint: 'license-key event' },
  ];

  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % STAGES.length), 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-full w-full p-5">
      <div className="absolute left-4 top-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <Truck size={11} /> CJ Dropshipping · End-to-End
      </div>

      <div className="mt-10 flex h-[calc(100%-3rem)] items-center justify-between gap-2">
        {STAGES.map((s, i) => {
          const isActive = i === active;
          const isDone   = i < active;
          return (
            <div key={s.label} className="flex flex-1 flex-col items-center">
              <div
                className="relative grid h-14 w-14 place-items-center rounded-2xl border transition-all duration-500"
                style={{
                  borderColor: isActive
                    ? 'rgba(244,63,94,0.5)'
                    : isDone
                    ? 'rgba(52,211,153,0.4)'
                    : 'rgba(255,255,255,0.08)',
                  background: isActive
                    ? 'rgba(244,63,94,0.12)'
                    : isDone
                    ? 'rgba(52,211,153,0.08)'
                    : 'rgba(255,255,255,0.02)',
                  transform: isActive ? 'scale(1.1)' : 'scale(1)',
                  boxShadow: isActive ? '0 0 32px rgba(244,63,94,0.4)' : 'none',
                }}
              >
                <s.icon
                  size={22}
                  className="transition-colors"
                  style={{
                    color: isActive ? '#fda4af' : isDone ? '#34d399' : '#52525b',
                  }}
                />
                {isActive && (
                  <span
                    className="absolute -inset-1 rounded-2xl"
                    style={{
                      border: '1px solid rgba(244,63,94,0.4)',
                      animation: 'pulse-slow 1.5s ease-in-out infinite',
                    }}
                  />
                )}
              </div>
              <div className="mt-2 text-[10px] font-semibold text-white">{s.label}</div>
              <div className="mt-0.5 text-center text-[9px] text-zinc-500">{s.hint}</div>
            </div>
          );
        })}

        {/* Connector arrows */}
        <svg viewBox="0 0 100 10" className="pointer-events-none absolute left-5 right-5 top-[calc(50%+0.5rem)] h-2.5">
          {[12.5, 37.5, 62.5, 87.5].slice(0, -1).map((x, i) => (
            <g key={i}>
              <line
                x1={x + 5} y1="5" x2={x + 20} y2="5"
                stroke={i < active ? '#34d399' : 'rgba(255,255,255,0.1)'}
                strokeWidth="0.5"
                strokeDasharray={i === active ? '1 1' : ''}
              >
                {i === active && (
                  <animate attributeName="stroke-dashoffset" from="0" to="4" dur="0.6s" repeatCount="indefinite" />
                )}
              </line>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. Anti-Bann / CAPTCHA stack
// ──────────────────────────────────────────────────────────────────────────────
function AntiBannVisual() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, []);

  const BARS = 24;
  return (
    <div className="relative h-full w-full p-5">
      <div className="absolute left-4 top-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <ShieldCheck size={11} /> Anti-Bann · CAPTCHA · Behavior-Jitter
      </div>

      {/* Waveform — Whisper transcribing audio CAPTCHA */}
      <div className="mt-8 flex h-20 items-center justify-center gap-1">
        {Array.from({ length: BARS }).map((_, i) => {
          const phase = (tick + i * 2) * 0.4;
          const h = 8 + Math.abs(Math.sin(phase)) * 32 + Math.abs(Math.sin(phase * 0.6)) * 14;
          const active = i < ((tick * 1.5) % (BARS + 4));
          return (
            <div
              key={i}
              className="w-1 rounded-full transition-all duration-100"
              style={{
                height: `${h}px`,
                background: active
                  ? 'linear-gradient(180deg, #fb7185, #6366f1)'
                  : 'rgba(255,255,255,0.08)',
                boxShadow: active ? '0 0 6px rgba(244,63,94,0.5)' : 'none',
              }}
            />
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 font-mono text-[10px]">
        <ScanLine size={11} className="text-ruby-300 animate-pulse" />
        <span className="text-zinc-400">whisper.cpp</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-400">→</span>
        <span className="text-zinc-600">·</span>
        <span className="text-emerald-300">solved</span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[10px]">
        <Stat label="CAPTCHA-Rate"   value="< 1 %" tone="emerald" />
        <Stat label="Solving Cost"   value="0,00 €" tone="emerald" />
        <Stat label="Bann-Rate"      value="~ 0 %" tone="emerald" />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'emerald' }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
      <div className="text-[8px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xs font-bold text-${tone}-300`}>{value}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Public component
// ──────────────────────────────────────────────────────────────────────────────
export function FeatureShowcase() {
  return (
    <section id="features" className="relative py-24">
      <div className="container-narrow">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">
              <Globe size={12} /> Im System
            </span>
            <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-5xl mt-5" style={{ letterSpacing: '-0.025em' }}>
              So sieht der <span className="gradient-text">Hustle</span> aus.
            </h2>
            <p className="mt-5 text-zinc-400">
              Keine Marketing-Screenshots, sondern eine Live-Visualisierung dessen, was
              im Hintergrund läuft. Sechs Module, alle vollautomatisch.
            </p>
          </div>
        </Reveal>
      </div>

      <div className="mt-10">
        <Panel
          eyebrow="01 · Model Studio"
          title="Dein Brand-Model. Konsistent auf jedem Foto."
          body="11 Picker — Ethnicity, Skin, Hair, Eyes, Face, Body, Height, Age, Makeup, Aesthetic, Mood — definieren ein Modell, das Gemini auf jedem generierten Listing-Foto wiedererkennt. Einmal locken, alle 1.000 Fotos teilen dasselbe Gesicht."
          visual={<ModelStudioVisual />}
        />
        <Panel
          eyebrow="02 · Scene Generation"
          title="Vier Lifestyle-Szenen pro Listing. Automatisch."
          body="Mirror-Selfie, Café, Outdoor, Studio — Gemini rendert die vier Standard-Szenen in deinem Brand-Stil, ~ 0,20 € pro Listing. Du lädst ein Produkt hoch, bekommst vier verkaufsfertige Fotos zurück."
          visual={<SceneGenVisual />}
          reverse
        />
        <Panel
          eyebrow="03 · Crosslisting"
          title="Ein Listing. 21 Marktplätze. Ein Klick."
          body="Vinted, Kleinanzeigen, eBay, Depop, Mercari, Wallapop, Etsy, Grailed plus 13 weitere — alle parallel, pro Plattform eigene Variant (Gen-Z auf Vinted, formal auf eBay, neutral auf KA). Verkauft sich was, wird es überall automatisch deaktiviert."
          visual={<CrosslistVisual />}
        />
        <Panel
          eyebrow="04 · Auto-Repricer · Re-Lister"
          title="24 h nach dem Sale: neu gelistet. Anti-Bann."
          body="Verkauf? Re-Lister wartet 24 h, shuffled die Fotos, jittered den Preis um ± 5 %, variiert den Titel — Vinted erkennt das Listing nicht als Duplikat. Repricer beobachtet die Markt-Range parallel und justiert nach."
          visual={<RepricerVisual />}
          reverse
        />
        <Panel
          eyebrow="05 · CJ Dropshipping"
          title="Sale → CJ-Order → Tracking. Du fasst nichts an."
          body="Bei jedem Verkauf bestellt Blackruby automatisch bei CJ — direkt an deinen Vinted-Käufer, mit synchronisiertem Tracking-Code. Lager null. Versand null. Pre-Flight checkt Stock + Adresse bevor die Order rausgeht."
          visual={<CjFlowVisual />}
        />
        <Panel
          eyebrow="06 · Anti-Bann Stack"
          title="Whisper. Behavior-Jitter. Praktisch unsichtbar."
          body="Audio-CAPTCHAs löst whisper.cpp lokal (0 €). Human-Behavior-Helper jittered Maus, Tipprhythmus und Scroll. 3-Layer-Strategie: avoid → solve → manual-resume. Bann-Rate in unseren Beta-Accounts: praktisch null."
          visual={<AntiBannVisual />}
          reverse
        />
      </div>
    </section>
  );
}
