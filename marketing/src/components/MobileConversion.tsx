// Mobile-specific conversion components.
//
// All of these are visible ONLY below the md breakpoint (`md:hidden`).
// Designed for TikTok-driven traffic: lots of stop-scroll moments, big
// CTAs, real social proof, no clutter. The desktop site keeps its rich
// dashboard mockups; this is the parallel mobile experience.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Sparkles,
  ShoppingBag,
  Truck,
  ShieldCheck,
  Lock,
  Zap,
  Rocket,
  Flame,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────────
// MobileInlineCta — drop-in mid-page CTA so the user always has the next
// "Lizenz holen" tap within reach. Multiple visual variants so repeating it
// 3-4× through the page doesn't read like a single copy-pasted banner.
// ──────────────────────────────────────────────────────────────────────────────
export function MobileInlineCta({
  variant = 'gradient',
  headline,
  sub,
  cta = 'Lizenz holen',
}: {
  variant?: 'gradient' | 'solid' | 'split' | 'urgency';
  headline: string;
  sub?: string;
  cta?: string;
}) {
  if (variant === 'split') {
    return (
      <section className="px-5 py-6 md:hidden">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ruby-300">
              <Flame size={12} /> Limited Beta
            </div>
            <div className="mt-1.5 text-[16px] font-bold leading-snug text-white">{headline}</div>
            {sub && <p className="mt-1 text-[12px] leading-snug text-zinc-400">{sub}</p>}
          </div>
          <Link
            to="/pricing"
            className="flex w-full items-center justify-center gap-1.5 bg-gradient-to-r from-ruby-500 via-violet-500 to-indigo-500 px-4 py-3.5 text-[14px] font-bold text-white"
          >
            {cta} · 99 €/Monat
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    );
  }

  if (variant === 'urgency') {
    return (
      <section className="px-5 py-6 md:hidden">
        <Link
          to="/pricing"
          className="relative block overflow-hidden rounded-2xl border border-ruby-500/30 bg-gradient-to-br from-ruby-500/15 via-violet-500/10 to-indigo-500/15 p-5"
        >
          <div className="absolute inset-0 bg-grid opacity-30" />
          <div className="relative flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-ruby-500 to-indigo-500 text-white shadow-xl shadow-ruby-500/40">
              <Rocket size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold text-white">{headline}</div>
              {sub && <p className="mt-0.5 text-[11px] text-zinc-400">{sub}</p>}
            </div>
            <ArrowRight size={16} className="shrink-0 text-ruby-300" />
          </div>
          <div className="relative mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-zinc-950/70 py-2 text-[12px] font-bold text-white backdrop-blur">
            {cta} <ArrowRight size={13} />
          </div>
        </Link>
      </section>
    );
  }

  if (variant === 'solid') {
    return (
      <section className="px-5 py-6 md:hidden">
        <Link
          to="/pricing"
          className="flex items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 text-zinc-950 shadow-xl shadow-black/30"
        >
          <div className="min-w-0">
            <div className="text-[14px] font-bold leading-tight">{headline}</div>
            {sub && <p className="mt-0.5 text-[11px] text-zinc-600">{sub}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-xl bg-zinc-950 px-3 py-2 text-[12px] font-bold text-white">
            {cta}
            <ArrowRight size={13} />
          </div>
        </Link>
      </section>
    );
  }

  // gradient (default)
  return (
    <section className="px-5 py-6 md:hidden">
      <Link
        to="/pricing"
        className="relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl border border-white/10 px-5 py-4 backdrop-blur"
      >
        <span
          className="absolute inset-0 -z-10"
          style={{
            background: 'linear-gradient(120deg, rgba(244,63,94,0.2), rgba(139,92,246,0.2), rgba(99,102,241,0.2))',
            backgroundSize: '200% 200%',
            animation: 'gradient-x 4s ease infinite',
          }}
        />
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-ruby-500 to-indigo-500 text-white">
            <Zap size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold leading-tight text-white">{headline}</div>
            {sub && <p className="mt-0.5 text-[11px] text-zinc-400">{sub}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-zinc-950">
          {cta}
          <ArrowRight size={13} />
        </div>
      </Link>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MobileStickyCta — always-on bottom bar with price + CTA.
// Slides up after the user scrolls ~400 px so it doesn't fight with the hero.
// Hidden once the user reaches the bottom CtaBanner (so it doesn't overlap).
// ──────────────────────────────────────────────────────────────────────────────
export function MobileStickyCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onScroll() {
      // Show as soon as the user scrolls past the hero. Stay visible all
      // the way to the bottom — losing the CTA right before the user hits
      // the footer costs conversions on TikTok traffic that doesn't always
      // scroll past the pricing section.
      setShow(window.scrollY > 400);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className={`fixed inset-x-3 bottom-3 z-50 md:hidden ${
        show ? 'translate-y-0 opacity-100' : 'translate-y-32 opacity-0'
      } transition-all duration-300 ease-out`}
    >
      <Link
        to="/pricing"
        className="relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur-xl"
      >
        {/* Animated gradient bg */}
        <span
          className="absolute inset-0 -z-10"
          style={{
            background: 'linear-gradient(120deg, rgba(244,63,94,0.15), rgba(139,92,246,0.15), rgba(99,102,241,0.15))',
            backgroundSize: '200% 200%',
            animation: 'gradient-x 4s ease infinite',
          }}
        />
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-ruby-500 to-indigo-500 text-white">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-white">
              Lizenz ab <span className="font-mono">99 €/Monat</span>
            </div>
            <div className="truncate text-[10px] text-zinc-400">
              7-Tage Geld-zurück · monatlich kündbar
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-zinc-950">
          Jetzt holen
          <ArrowRight size={14} />
        </div>
      </Link>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MobileProofStrip — vertical stack of live-feeling event cards. Cycles
// through a longer feed so the visitor sees motion even after a few
// seconds. Each card looks like a real Vinted/Blackruby notification.
// ──────────────────────────────────────────────────────────────────────────────
const PROOF_EVENTS = [
  { icon: ShoppingBag,  tone: 'ruby',    title: 'Sale · Lisa M., Stuttgart', body: 'Cropped Wool Cardigan · 27,90 €' },
  { icon: CheckCircle2, tone: 'emerald', title: 'CJ-Order fired',            body: 'Tracking YT2521421266234876' },
  { icon: Truck,        tone: 'indigo',  title: 'Listing crossposted',        body: 'Vinted · KA · Depop · eBay · 0,82 s' },
  { icon: ShieldCheck,  tone: 'violet',  title: 'CAPTCHA solved',             body: 'whisper.cpp · 0,62 s · 0,00 €' },
  { icon: Sparkles,     tone: 'ruby',    title: 'Scene-Gen complete',         body: '4 photos · model: aurelia · 0,21 €' },
  { icon: ShoppingBag,  tone: 'ruby',    title: 'Sale · Anna K., Hamburg',    body: 'Light Blue Pleated Skirt · 32,00 €' },
  { icon: Lock,         tone: 'emerald', title: 'Session warmed',             body: '14 m organic browse · acct #3' },
];

export function MobileProofStrip() {
  const [head, setHead] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setHead((h) => (h + 1) % PROOF_EVENTS.length), 1800);
    return () => clearInterval(id);
  }, []);

  const visible = [0, 1, 2].map((offset) => PROOF_EVENTS[(head + offset) % PROOF_EVENTS.length]);

  return (
    <section className="px-5 py-12 md:hidden">
      <div className="mb-5 text-center">
        <span className="eyebrow">
          <Sparkles size={12} /> Live im System
        </span>
        <h2 className="font-display mt-3 text-2xl font-bold tracking-tight text-white">
          Während du das liest, passiert das.
        </h2>
      </div>
      <div ref={containerRef} className="relative space-y-2.5 overflow-hidden">
        {visible.map((e, i) => {
          const Icon = e.icon;
          const cls = {
            ruby:    { ring: 'border-ruby-500/30',    bg: 'bg-ruby-500/10',    icon: 'text-ruby-300',    dot: 'bg-ruby-400'    },
            emerald: { ring: 'border-emerald-500/30', bg: 'bg-emerald-500/10', icon: 'text-emerald-300', dot: 'bg-emerald-400' },
            indigo:  { ring: 'border-indigo-500/30',  bg: 'bg-indigo-500/10',  icon: 'text-indigo-300',  dot: 'bg-indigo-400'  },
            violet:  { ring: 'border-violet-500/30',  bg: 'bg-violet-500/10',  icon: 'text-violet-300',  dot: 'bg-violet-400'  },
          }[e.tone as 'ruby' | 'emerald' | 'indigo' | 'violet'];
          return (
            <div
              key={`${head}-${i}`}
              className={`flex items-center gap-3 rounded-xl border ${cls.ring} ${cls.bg} bg-zinc-950/60 px-3 py-3 backdrop-blur`}
              style={{
                opacity: i === 0 ? 1 : 1 - i * 0.18,
                transform: `scale(${1 - i * 0.02}) translateY(${i === 0 ? '0px' : '0px'})`,
                animation: i === 0 ? 'fade-up 400ms ease-out' : undefined,
              }}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${cls.ring} ${cls.bg}`}>
                <Icon size={16} className={cls.icon} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-white">
                  <span className={`h-1.5 w-1.5 rounded-full ${cls.dot} ${i === 0 ? 'animate-pulse' : ''}`} />
                  {e.title}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-400">{e.body}</div>
              </div>
              {i === 0 && (
                <span className="rounded-full bg-zinc-950 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                  jetzt
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MobileQuickPitch — short-form pitch block right after the hero with a
// scannable 3-bullet sales argument. Optimised for ad-driven viewers
// who decided in <3 s whether to scroll further.
// ──────────────────────────────────────────────────────────────────────────────
export function MobileQuickPitch() {
  const POINTS = [
    { icon: Sparkles,    title: 'Foto rein, Listing raus',         body: 'KI macht Title, Description, Preis, 4 Lifestyle-Fotos.' },
    { icon: ShoppingBag, title: '21 Plattformen mit 1 Klick',      body: 'Vinted · KA · eBay · Depop · Mercari · Etsy · 15 mehr.' },
    { icon: Truck,       title: 'CJ liefert direkt zum Käufer',    body: 'Kein Lager. Kein Versand. Du fasst nichts an.' },
  ];
  return (
    <section className="px-5 py-12 md:hidden">
      <div className="space-y-2.5">
        {POINTS.map((p) => {
          const Icon = p.icon;
          return (
            <div
              key={p.title}
              className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-ruby-500/20 to-indigo-500/20 text-ruby-300 ring-1 ring-ruby-500/20">
                <Icon size={18} />
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-white">{p.title}</div>
                <p className="mt-0.5 text-[12px] leading-snug text-zinc-400">{p.body}</p>
              </div>
            </div>
          );
        })}
      </div>
      <Link
        to="/pricing"
        className="btn-primary mt-5 w-full justify-center text-[14px]"
      >
        Lizenz holen · 99 €/Monat
        <ArrowRight size={14} />
      </Link>
      <p className="mt-3 text-center text-[11px] text-zinc-500">
        Monatlich kündbar · 7-Tage Geld-zurück · Mac &amp; Windows
      </p>
    </section>
  );
}
