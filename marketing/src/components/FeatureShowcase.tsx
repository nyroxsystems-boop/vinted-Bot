// FeatureShowcase — six product-style panels showcasing the core modules.
//
// Each panel is a mini-window that LOOKS like a real piece of the Blackruby
// dashboard: macOS-style chrome, sidebar/header where it makes sense, live
// data that ticks. The point is to communicate "this is software, not a
// pitch deck" — no stock screenshots, but enough fidelity that the visitor
// sees the actual mental model of the feature.
//
// Layout: alternating L/R per panel. The visual side gets a window frame
// with a title-bar (traffic-light dots + filename), and a content area
// densely filled with the right primitives for that feature.

import { useEffect, useState } from 'react';
import {
  Sparkles,
  Lock,
  Wand2,
  Truck,
  Check,
  ScanLine,
  Activity,
  Tag,
  Image as ImageIcon,
  CheckCircle2,
  Loader2,
  CircleDot,
  CircleDashed,
  Mic,
  Cpu,
  ShoppingBag,
} from 'lucide-react';
import { Reveal } from './Reveal';

// ──────────────────────────────────────────────────────────────────────────────
// Marketplace list
// ──────────────────────────────────────────────────────────────────────────────
const MARKETPLACES = [
  { name: 'Vinted',           hue: 178 },
  { name: 'Kleinanzeigen',    hue: 84  },
  { name: 'eBay-DE',          hue: 220 },
  { name: 'eBay-UK',          hue: 220 },
  { name: 'Depop',            hue: 348 },
  { name: 'Mercari',          hue: 13  },
  { name: 'Wallapop',         hue: 152 },
  { name: 'Etsy',             hue: 25  },
  { name: 'Grailed',          hue: 0   },
  { name: 'FB Marketplace',   hue: 220 },
  { name: 'Vestiaire',        hue: 0   },
  { name: 'Whatnot',          hue: 35  },
  { name: 'Shpock',           hue: 195 },
  { name: 'Poshmark',         hue: 350 },
  { name: 'TradeMe',          hue: 200 },
  { name: 'Rebelle',          hue: 0   },
  { name: 'Vide-Dressing',    hue: 200 },
  { name: 'Momox',            hue: 100 },
  { name: 'Sellpy',           hue: 130 },
  { name: 'Kleiderkreisel',   hue: 178 },
  { name: 'Mädchenflohmarkt', hue: 320 },
];

// ──────────────────────────────────────────────────────────────────────────────
// Shared chrome
// ──────────────────────────────────────────────────────────────────────────────
function WindowFrame({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="ring-glow relative h-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/85 backdrop-blur">
      {/* macOS-style title bar */}
      <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          </div>
          <span className="ml-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{title}</span>
        </div>
        {badge && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
            <span className="mr-1 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-emerald-400" />
            {badge}
          </span>
        )}
      </div>
      {/* Content area */}
      <div className="relative h-[calc(100%-2.5rem)]">{children}</div>
    </div>
  );
}

function Panel({
  eyebrow,
  title,
  body,
  visual,
  reverse,
  bullets,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  visual: React.ReactNode;
  reverse?: boolean;
  bullets?: string[];
}) {
  return (
    <Reveal as="article" className="py-6 md:py-16">
      <div
        className={`container-narrow grid items-center gap-6 md:grid-cols-2 md:gap-16 ${
          reverse ? 'md:[&>*:first-child]:order-2' : ''
        }`}
      >
        <div className="space-y-3 md:space-y-6">
          <span className="eyebrow">{eyebrow}</span>
          <h3
            className="font-display text-2xl font-bold tracking-tight text-white sm:text-4xl"
            style={{ letterSpacing: '-0.02em' }}
          >
            {title}
          </h3>
          <p className="max-w-md text-sm leading-relaxed text-zinc-400 md:text-base">{body}</p>
          {bullets && (
            <ul className="space-y-1.5 md:space-y-2">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-[13px] text-zinc-300 md:text-sm">
                  <Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Mobile (<md): hide the heavy desktop visualization entirely. Users
            on TikTok-driven traffic don't need a tiny mock window — they get
            the bullets above and the proof shots elsewhere. */}
        <div className="relative hidden aspect-[4/2.8] md:block">
          <div className="absolute inset-0 -m-6 -z-10 rounded-3xl bg-gradient-to-br from-ruby-500/15 via-violet-500/10 to-indigo-500/15 blur-2xl" />
          {visual}
        </div>
      </div>
    </Reveal>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Model Studio — realistic property-row UI with live swatch cycling
// ──────────────────────────────────────────────────────────────────────────────
function ModelStudioVisual() {
  const PROPS = [
    { label: 'Ethnicity',  swatches: ['Asian', 'Black', 'White', 'Latina', 'MENA'],     activeIdx: 2 },
    { label: 'Skin Tone',  swatches: ['Porcelain', 'Light', 'Tan', 'Olive', 'Deep'],    activeIdx: 1 },
    { label: 'Hair',       swatches: ['Blonde', 'Brunette', 'Black', 'Ginger'],         activeIdx: 1 },
    { label: 'Eyes',       swatches: ['Blue', 'Green', 'Hazel', 'Brown'],               activeIdx: 0 },
    { label: 'Face',       swatches: ['Round', 'Oval', 'Heart', 'Square'],              activeIdx: 1 },
    { label: 'Body',       swatches: ['Slim', 'Athletic', 'Curvy'],                     activeIdx: 1 },
    { label: 'Age',        swatches: ['19–24', '25–32', '33–40'],                       activeIdx: 0 },
    { label: 'Aesthetic',  swatches: ['Streetwear', 'Soft Girl', 'Y2K', 'Minimal'],     activeIdx: 1 },
  ];

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 900);
    return () => clearInterval(id);
  }, []);

  return (
    <WindowFrame title="model-studio · brand-lock" badge="Active">
      <div className="grid h-full grid-cols-12 gap-3 p-4">
        {/* Left: avatar */}
        <div className="col-span-4 flex flex-col items-center justify-center rounded-xl border border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent p-3">
          <div className="relative">
            <div className="absolute inset-0 -m-3 rounded-full bg-ruby-500/25 blur-2xl animate-pulse-slow" />
            <svg viewBox="0 0 100 130" className="relative h-28 w-28 sm:h-32 sm:w-32">
              <defs>
                <linearGradient id="ms-skin" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%"   stopColor="#fda4af" />
                  <stop offset="100%" stopColor="#c084fc" />
                </linearGradient>
                <linearGradient id="ms-shoulder" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor="#27272a" />
                  <stop offset="100%" stopColor="#0a0a0c" />
                </linearGradient>
              </defs>
              {/* Hair */}
              <path d="M 22 38 Q 22 12 50 10 Q 78 12 78 38 Q 76 30 50 24 Q 24 30 22 38 Z" fill="#1f1b18" />
              {/* Head */}
              <ellipse cx="50" cy="42" rx="20" ry="24" fill="url(#ms-skin)" />
              {/* Neck */}
              <rect x="44" y="62" width="12" height="10" fill="url(#ms-skin)" />
              {/* Shoulders */}
              <path d="M 8 130 Q 8 80 50 72 Q 92 80 92 130 Z" fill="url(#ms-shoulder)" />
              {/* Eyes */}
              <circle cx="42" cy="42" r="1.4" fill="#0a0a0c" />
              <circle cx="58" cy="42" r="1.4" fill="#0a0a0c" />
              {/* Lips */}
              <path d="M 44 52 Q 50 56 56 52" stroke="#9d174d" strokeWidth="1.2" fill="none" strokeLinecap="round" />
              {/* Scan line moving down */}
              <line
                x1="6" x2="94"
                y1={20 + (tick * 8) % 110}
                y2={20 + (tick * 8) % 110}
                stroke="#fda4af"
                strokeWidth="0.4"
                opacity="0.6"
              />
            </svg>
          </div>
          <div className="mt-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Active Model</div>
            <div className="mt-0.5 text-xs font-semibold text-white">aurelia · v3</div>
          </div>
        </div>

        {/* Right: property rows */}
        <div className="col-span-8 space-y-1.5">
          {PROPS.map((p, rowIdx) => {
            const shift = Math.floor((tick + rowIdx * 2) / 3);
            const active = (p.activeIdx + shift) % p.swatches.length;
            return (
              <div
                key={p.label}
                className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1"
              >
                <div className="w-20 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                  {p.label}
                </div>
                <div className="flex flex-1 flex-wrap gap-1">
                  {p.swatches.map((s, i) => {
                    const isActive = i === active;
                    return (
                      <span
                        key={s}
                        className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition-all duration-500 ${
                          isActive
                            ? 'border border-ruby-500/50 bg-ruby-500/15 text-ruby-200'
                            : 'border border-white/5 bg-white/[0.02] text-zinc-500'
                        }`}
                      >
                        {s}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute inset-x-4 bottom-3 flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-1.5">
        <span className="flex items-center gap-2 text-[10px] font-mono text-emerald-200">
          <Lock size={11} /> Model locked → applied to next 1.000 generations
        </span>
        <span className="font-mono text-[10px] text-emerald-300/70">~ 0,04 €/preview</span>
      </div>
    </WindowFrame>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. Scene Generation — realistic generation grid with shimmer
// ──────────────────────────────────────────────────────────────────────────────
function SceneGenVisual() {
  const SCENES = [
    { id: 'mirror',  label: 'mirror_selfie.jpg', from: '#f43f5e', to: '#fb7185' },
    { id: 'cafe',    label: 'cafe.jpg',          from: '#b45309', to: '#fbbf24' },
    { id: 'outdoor', label: 'outdoor.jpg',       from: '#059669', to: '#34d399' },
    { id: 'studio',  label: 'studio.jpg',        from: '#6366f1', to: '#a78bfa' },
  ];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % 4), 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <WindowFrame title="scene-gen · gemini" badge="Generating">
      <div className="flex h-full flex-col p-4">
        {/* Prompt-row */}
        <div className="mb-3 flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px]">
          <Wand2 size={11} className="text-violet-300" />
          <span className="text-zinc-400">prompt</span>
          <span className="text-zinc-600">›</span>
          <span className="truncate text-zinc-200">
            mirror selfie wearing <span className="text-ruby-300">[item-4982]</span>, brand-model <span className="text-violet-300">aurelia</span>, natural light
          </span>
        </div>

        <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
          {SCENES.map((s, i) => {
            const isActive   = active === i;
            const isDone     = ((active - i + 4) % 4) > 0;
            return (
              <div
                key={s.id}
                className="relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]"
              >
                <div
                  className="absolute inset-0 transition-opacity duration-700"
                  style={{
                    background: `radial-gradient(circle at 50% 60%, ${s.from} 0%, ${s.to} 60%, transparent 100%)`,
                    opacity: isDone || isActive ? 0.55 : 0.08,
                  }}
                />
                {isActive && (
                  <div
                    className="absolute inset-0"
                    style={{
                      background: 'linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 1.4s linear infinite',
                    }}
                  />
                )}
                {/* Photo silhouette */}
                <svg viewBox="0 0 80 60" className="absolute inset-0 h-full w-full opacity-55">
                  <ellipse cx="40" cy="25" rx="7" ry="7" fill="rgba(255,255,255,0.55)" />
                  <path d="M 24 60 Q 24 38 40 36 Q 56 38 56 60 Z" fill="rgba(255,255,255,0.45)" />
                </svg>
                {/* Footer row */}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-zinc-950/70 px-2 py-1 font-mono text-[9px] backdrop-blur">
                  <span className="flex items-center gap-1 text-white/80">
                    <ImageIcon size={9} />
                    {s.label}
                  </span>
                  {isDone ? (
                    <CheckCircle2 size={11} className="text-emerald-300" />
                  ) : isActive ? (
                    <Loader2 size={10} className="animate-spin text-violet-300" />
                  ) : (
                    <CircleDashed size={10} className="text-zinc-600" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-[10px]">
          <div className="flex items-center gap-2 font-mono text-zinc-400">
            <Cpu size={11} className="text-violet-300" />
            gemini-2.5-flash · <span className="text-zinc-300">{active + 1} / 4</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-white/5 bg-white/[0.02] px-2 py-0.5 font-mono">
            <Tag size={10} className="text-emerald-300" />
            <span className="text-zinc-400">cost</span>
            <span className="text-emerald-300">~ 0,20 € / listing</span>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Crosslisting — source card + 21-marketplace publish status list
// ──────────────────────────────────────────────────────────────────────────────
function CrosslistVisual() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % (MARKETPLACES.length + 4)), 320);
    return () => clearInterval(id);
  }, []);

  return (
    <WindowFrame title="crosslist · 21 marktplätze" badge="Publishing">
      <div className="grid h-full grid-cols-12 gap-3 p-4">
        {/* Left: source listing */}
        <div className="col-span-5 space-y-2">
          <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">Source listing</div>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="relative aspect-[3/4] overflow-hidden bg-zinc-900">
              <img
                src="/listings/products/p5.jpg"
                alt="Source listing"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute right-1.5 top-1.5 rounded-md bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[8px] text-white/90 backdrop-blur">
                item-4982
              </div>
            </div>
            <div className="space-y-1 p-2">
              <div className="truncate text-[10px] font-semibold text-white">Cropped Wool Cardigan · Cream</div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold text-ruby-300">27,90 €</span>
                <span className="font-mono text-[9px] text-zinc-500">Size S</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <SmallStat label="views" value="380+" tone="ruby" />
            <SmallStat label="hearts" value="24" tone="ruby" />
            <SmallStat label="offers" value="3" tone="ruby" />
          </div>
        </div>

        {/* Right: marketplaces publish list */}
        <div className="col-span-7">
          <div className="mb-2 flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-zinc-500">
            <span>Targets · {MARKETPLACES.length}</span>
            <span className="text-emerald-300">
              {Math.min(step, MARKETPLACES.length)} published
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 overflow-hidden">
            {MARKETPLACES.map((m, i) => {
              const done    = step > i;
              const active  = step === i;
              return (
                <div
                  key={m.name}
                  className="flex items-center justify-between gap-1.5 rounded border border-white/5 bg-white/[0.02] px-1.5 py-0.5 transition"
                  style={{
                    background: active
                      ? `linear-gradient(90deg, hsla(${m.hue}, 80%, 55%, 0.12), transparent)`
                      : undefined,
                  }}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: done
                          ? `hsl(${m.hue}, 75%, 55%)`
                          : active
                          ? `hsl(${m.hue}, 90%, 65%)`
                          : 'rgba(255,255,255,0.12)',
                        boxShadow: active ? `0 0 8px hsl(${m.hue}, 90%, 65%)` : 'none',
                      }}
                    />
                    <span className="truncate text-[10px] font-medium text-zinc-300">{m.name}</span>
                  </div>
                  {done ? (
                    <CheckCircle2 size={11} className="shrink-0 text-emerald-300" />
                  ) : active ? (
                    <Loader2 size={10} className="shrink-0 animate-spin text-zinc-300" />
                  ) : (
                    <CircleDot size={10} className="shrink-0 text-zinc-700" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

function SmallStat({ label, value, tone }: { label: string; value: string; tone: 'ruby' }) {
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] py-1">
      <div className={`font-mono text-[10px] font-bold text-${tone}-300`}>{value}</div>
      <div className="text-[8px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. Auto-Repricer + Re-Lister — KPIs, chart, event log
// ──────────────────────────────────────────────────────────────────────────────
function RepricerVisual() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 240);
    return () => clearInterval(id);
  }, []);

  const POINTS = 40;
  const path = Array.from({ length: POINTS }, (_, i) => {
    const x = (i / (POINTS - 1)) * 92 + 4;
    const phase = (tick + i) * 0.16;
    const y = 25
      - Math.sin(phase) * 6
      - Math.sin(phase * 0.5) * 3
      + (((tick + i) * 11) % 13) * 0.3;
    return [x, y] as const;
  });
  const d = path.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
  const last = path[path.length - 1];
  const currentPrice = 27.9 - Math.sin(tick * 0.16) * 1.5 - ((tick * 11) % 13) * 0.08;
  const hourLeft = Math.max(0, 24 - Math.floor((tick % 90) * 0.27));
  const firing = hourLeft === 0;

  // Event log entries (looped from a deterministic set)
  const EVENTS = [
    { time: '21:34:01', kind: 'price', text: 'item-4982 → 27,90 €', accent: 'text-emerald-300' },
    { time: '21:33:48', kind: 'relist', text: 'item-4716 re-listed (photo shuffle)', accent: 'text-violet-300' },
    { time: '21:33:21', kind: 'view',  text: 'item-4982 favorited · user_8842', accent: 'text-ruby-300' },
    { time: '21:32:55', kind: 'price', text: 'item-5121 → 14,20 €', accent: 'text-emerald-300' },
    { time: '21:32:30', kind: 'relist', text: 'item-4623 re-listed (title variant)', accent: 'text-violet-300' },
  ];

  return (
    <WindowFrame title="repricer · re-lister" badge="Watching">
      <div className="flex h-full flex-col p-4">
        <div className="grid grid-cols-3 gap-2">
          <BigKpi label="Live-Preis" value={`${currentPrice.toFixed(2)} €`} accent="ruby" />
          <BigKpi label="Re-List in" value={`${hourLeft} h`} accent="indigo" sub={firing ? 'firing now' : 'cooldown'} />
          <BigKpi label="Views / 24 h" value={`${380 + (tick * 13) % 80}`} accent="violet" />
        </div>

        <div className="mt-3 h-20 w-full overflow-hidden rounded-lg border border-white/5 bg-white/[0.02]">
          <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-full w-full">
            <defs>
              <linearGradient id="rp-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"  stopColor="#fb7185" />
                <stop offset="60%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
              <linearGradient id="rp-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="rgba(244, 63, 94, 0.35)" />
                <stop offset="100%" stopColor="rgba(244, 63, 94, 0)" />
              </linearGradient>
            </defs>
            {/* baseline */}
            <line x1="0" x2="100" y1="22" y2="22" stroke="rgba(255,255,255,0.05)" strokeWidth="0.3" strokeDasharray="0.5 1" />
            <path d={`${d} L 96 32 L 4 32 Z`} fill="url(#rp-fill)" />
            <path d={d} stroke="url(#rp-line)" strokeWidth="0.8" fill="none" />
            <circle cx={last[0]} cy={last[1]} r="1.4" fill="#fb7185">
              <animate attributeName="r" values="1.4;2.4;1.4" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
        </div>

        <div className="mt-3 flex-1 overflow-hidden rounded-lg border border-white/5 bg-black/30 font-mono">
          <div className="border-b border-white/5 bg-white/[0.02] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
            event log
          </div>
          <div className="space-y-0.5 px-2.5 py-1.5 text-[10px]">
            {EVENTS.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-zinc-400">
                <span className="text-zinc-600">{e.time}</span>
                <span className={`uppercase text-[8px] tracking-wider ${e.accent}`}>{e.kind}</span>
                <span className="truncate text-zinc-300">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

function BigKpi({ label, value, accent, sub }: { label: string; value: string; accent: 'ruby' | 'indigo' | 'violet'; sub?: string }) {
  const cls = accent === 'ruby' ? 'text-ruby-300' : accent === 'indigo' ? 'text-indigo-300' : 'text-violet-300';
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
      <div className="text-[8px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-bold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[8px] text-zinc-500">{sub}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. CJ Dropshipping — order card + 4-stage timeline + tracking
// ──────────────────────────────────────────────────────────────────────────────
function CjFlowVisual() {
  const STAGES = [
    { icon: ShoppingBag,  label: 'Sale',     hint: 'Vinted ack' },
    { icon: Sparkles,     label: 'CJ Order', hint: 'API call' },
    { icon: Truck,        label: 'Shipping', hint: 'tracking #' },
    { icon: CheckCircle2, label: 'Delivered', hint: 'receipt' },
  ];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % STAGES.length), 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <WindowFrame title="cj-fulfillment · auto-order" badge="Order #4982">
      <div className="flex h-full flex-col p-4">
        {/* Order card */}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
            <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-zinc-500">
              <span>order-4982</span>
              <span>27,90 €</span>
            </div>
            <div className="mt-1.5 truncate text-[11px] font-semibold text-white">
              Cropped Wool Cardigan · Cream · S
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[9px] text-zinc-500">
              <span>Vinted</span>
              <span className="text-zinc-700">·</span>
              <span>Lisa M., Stuttgart</span>
              <span className="text-zinc-700">·</span>
              <span>ETA 4–6 d</span>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 font-mono text-[10px]">
            <div className="text-[8px] uppercase tracking-wider text-emerald-200/70">Margin</div>
            <div className="mt-0.5 text-lg font-bold text-emerald-300">+11,40 €</div>
            <div className="text-[8px] text-emerald-200/60">after CJ + fees</div>
          </div>
        </div>

        {/* Stage timeline */}
        <div className="mt-4 flex flex-1 items-center justify-between gap-1">
          {STAGES.map((s, i) => {
            const isActive = i === active;
            const isDone   = i < active;
            return (
              <div key={s.label} className="flex flex-1 flex-col items-center">
                <div
                  className="relative grid h-12 w-12 place-items-center rounded-xl border transition-all duration-500"
                  style={{
                    borderColor: isActive
                      ? 'rgba(244,63,94,0.55)'
                      : isDone
                      ? 'rgba(52,211,153,0.4)'
                      : 'rgba(255,255,255,0.08)',
                    background: isActive
                      ? 'rgba(244,63,94,0.14)'
                      : isDone
                      ? 'rgba(52,211,153,0.08)'
                      : 'rgba(255,255,255,0.02)',
                    transform: isActive ? 'scale(1.08)' : 'scale(1)',
                    boxShadow: isActive ? '0 0 32px rgba(244,63,94,0.4)' : 'none',
                  }}
                >
                  <s.icon
                    size={20}
                    className="transition-colors"
                    style={{ color: isActive ? '#fda4af' : isDone ? '#34d399' : '#52525b' }}
                  />
                  {isActive && (
                    <span
                      className="absolute -inset-1 rounded-xl"
                      style={{ border: '1px solid rgba(244,63,94,0.4)', animation: 'pulse-slow 1.5s ease-in-out infinite' }}
                    />
                  )}
                </div>
                <div className="mt-2 text-[10px] font-semibold text-white">{s.label}</div>
                <div className="mt-0.5 text-center text-[9px] text-zinc-500">{s.hint}</div>
              </div>
            );
          })}
        </div>

        {/* Tracking strip */}
        <div className="mt-3 flex items-center justify-between rounded-md border border-white/5 bg-white/[0.02] px-3 py-1.5 font-mono text-[10px]">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <Truck size={11} className="text-zinc-300" /> tracking
          </span>
          <span className="text-zinc-300">YT2521421266234876</span>
          <span className="text-emerald-300">in transit</span>
        </div>
      </div>
    </WindowFrame>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. Anti-Bann Stack — waveform + system log + stat trio
// ──────────────────────────────────────────────────────────────────────────────
function AntiBannVisual() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 110);
    return () => clearInterval(id);
  }, []);

  const BARS = 28;

  const LOG = [
    { t: '21:34:08', tag: 'captcha',   accent: 'text-emerald-300', text: 'audio solved · whisper.cpp · 0.62 s' },
    { t: '21:33:51', tag: 'jitter',    accent: 'text-violet-300',  text: 'mouse-jitter applied · listing-flow' },
    { t: '21:33:24', tag: 'warmup',    accent: 'text-indigo-300',  text: 'session warmed · 14 m organic browse' },
    { t: '21:32:59', tag: 'captcha',   accent: 'text-emerald-300', text: 'image solved · 2captcha bypass · 0.00 €' },
    { t: '21:32:17', tag: 'jitter',    accent: 'text-violet-300',  text: 'scroll-pause · 1.8 s · listing-detail' },
  ];

  return (
    <WindowFrame title="anti-bann · live" badge="Stealth">
      <div className="flex h-full flex-col p-4">
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="CAPTCHA-Rate"   value="< 1 %" />
          <StatPill label="Solving Cost"   value="0,00 €" />
          <StatPill label="Bann-Rate"      value="~ 0 %" />
        </div>

        {/* Waveform */}
        <div className="mt-3 rounded-lg border border-white/5 bg-black/30 p-2.5">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-500">
            <span className="flex items-center gap-1.5"><Mic size={11} className="text-ruby-300" /> whisper.cpp · audio captcha</span>
            <span className="text-emerald-300">decoded</span>
          </div>
          <div className="flex h-12 items-center justify-center gap-[3px]">
            {Array.from({ length: BARS }).map((_, i) => {
              const phase = (tick + i * 2) * 0.4;
              const h = 6 + Math.abs(Math.sin(phase)) * 28 + Math.abs(Math.sin(phase * 0.6)) * 12;
              const active = i < ((tick * 1.4) % (BARS + 4));
              return (
                <div
                  key={i}
                  className="w-1 rounded-full transition-all duration-100"
                  style={{
                    height: `${h}px`,
                    background: active
                      ? 'linear-gradient(180deg, #fb7185, #6366f1)'
                      : 'rgba(255,255,255,0.08)',
                    boxShadow: active ? '0 0 6px rgba(244,63,94,0.4)' : 'none',
                  }}
                />
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-2 font-mono text-[9px] text-zinc-400">
            <ScanLine size={10} className="text-ruby-300" />
            transcript:
            <span className="text-zinc-200">"three · seven · golf · whisky"</span>
          </div>
        </div>

        {/* System log */}
        <div className="mt-3 flex-1 overflow-hidden rounded-lg border border-white/5 bg-black/30 font-mono">
          <div className="border-b border-white/5 bg-white/[0.02] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
            stealth log
          </div>
          <div className="space-y-0.5 px-2.5 py-1.5 text-[10px]">
            {LOG.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-zinc-400">
                <span className="text-zinc-600">{e.t}</span>
                <span className={`text-[8px] uppercase tracking-wider ${e.accent}`}>{e.tag}</span>
                <span className="truncate text-zinc-300">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2 text-center">
      <div className="text-[8px] uppercase tracking-wider text-emerald-200/70">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">{value}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Public component
// ──────────────────────────────────────────────────────────────────────────────
export function FeatureShowcase() {
  return (
    <section id="features" className="relative pb-8 pt-14 md:pt-24">
      <div className="container-narrow">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">
              <Activity size={12} /> Im System
            </span>
            <h2
              className="font-display mt-5 text-3xl font-bold tracking-tight text-white sm:text-5xl"
              style={{ letterSpacing: '-0.025em' }}
            >
              Sechs Module. <span className="gradient-text">Volle Autonomie.</span>
            </h2>
            <p className="mt-4 text-base text-zinc-400 md:mt-5 md:text-lg">
              Echte Screens aus dem Live-System. Wenn du Blackruby öffnest, sieht
              es genauso aus — nur dass die Zahlen deine sind.
            </p>
          </div>
        </Reveal>
      </div>

      <div className="mt-10">
        <Panel
          eyebrow="01 · Model Studio"
          title={<>Dein Brand-Model. <span className="gradient-text">Konsistent</span> auf jedem Foto.</>}
          body="11 Picker — Ethnicity, Skin, Hair, Eyes, Face, Body, Height, Age, Makeup, Aesthetic, Mood — definieren ein Modell, das Gemini auf jedem generierten Listing-Foto wiedererkennt. Einmal locken, alle 1.000 Fotos teilen dasselbe Gesicht."
          bullets={[
            'Live-Preview pro Auswahl (~0,04 €)',
            'Optional: Reference-Photo Upload',
            'Aktives Modell wird als Lock-Prompt vorangestellt',
          ]}
          visual={<ModelStudioVisual />}
        />
        <Panel
          eyebrow="02 · Scene Generation"
          title={<>Vier Lifestyle-Szenen <span className="gradient-text">pro Listing.</span></>}
          body="Mirror-Selfie, Café, Outdoor, Studio — Gemini rendert die vier Standard-Szenen in deinem Brand-Stil. Du lädst ein Produkt hoch, bekommst vier verkaufsfertige Fotos zurück."
          bullets={[
            '~0,20 € pro Listing (Gemini Flash)',
            'Auto-Aspect: 3:4 für Vinted, 1:1 für eBay',
            'Asset-Tree gespeichert pro Produkt-Folder',
          ]}
          visual={<SceneGenVisual />}
          reverse
        />
        <Panel
          eyebrow="03 · Crosslisting"
          title={<>Ein Listing. <span className="gradient-text">21 Marktplätze.</span> Ein Klick.</>}
          body="Vinted, Kleinanzeigen, eBay, Depop, Mercari, Wallapop, Etsy, Grailed plus 13 weitere. Pro Plattform eigene Variant — Gen-Z auf Vinted, formal auf eBay, neutral auf KA."
          bullets={[
            'Auto-Sale-Detection auf allen Plattformen',
            'Sale auf einer Plattform → überall deaktiviert',
            'Pro Plattform Sprache + Tone-of-Voice optimiert',
          ]}
          visual={<CrosslistVisual />}
        />
        <Panel
          eyebrow="04 · Repricer · Re-Lister"
          title={<>24 h nach dem Sale: <span className="gradient-text">neu gelistet.</span></>}
          body="Verkauf? Re-Lister wartet 24 h, shuffled die Fotos, jittered den Preis um ± 5 %, variiert den Titel. Vinted erkennt das Listing nicht als Duplikat. Repricer beobachtet die Markt-Range parallel."
          bullets={[
            'Foto-Shuffle, Preis-Jitter, Titel-Variation',
            'Repricer matched Markt-Range automatisch',
            'Event-Log mit Timestamps für jede Action',
          ]}
          visual={<RepricerVisual />}
          reverse
        />
        <Panel
          eyebrow="05 · CJ Dropshipping"
          title={<>Sale → CJ-Order → Tracking. <span className="gradient-text">Vollautomatisch.</span></>}
          body="Bei jedem Verkauf bestellt Blackruby automatisch bei CJ — direkt an deinen Vinted-Käufer, mit synchronisiertem Tracking-Code. Lager null. Versand null."
          bullets={[
            'Pre-Flight: Stock + Adresse vor Order',
            'Tracking-Code automatisch an Käufer',
            'Margin pro Sale sichtbar',
          ]}
          visual={<CjFlowVisual />}
        />
        <Panel
          eyebrow="06 · Anti-Bann Stack"
          title={<>Whisper. Behavior-Jitter. <span className="gradient-text">Praktisch unsichtbar.</span></>}
          body="Audio-CAPTCHAs löst whisper.cpp lokal (0 €). Human-Behavior-Helper jittered Maus, Tipprhythmus und Scroll. 3-Layer-Strategie: avoid → solve → manual-resume."
          bullets={[
            'CAPTCHA-Rate < 1 % bei gewärmten Sessions',
            'Optional: 2captcha als Fallback ($0.10/Mt)',
            'Session-Warmup-Worker macht Accounts unauffällig',
          ]}
          visual={<AntiBannVisual />}
          reverse
        />
      </div>
    </section>
  );
}
