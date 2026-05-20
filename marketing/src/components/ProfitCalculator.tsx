// ──────────────────────────────────────────────────────────────────────────────
// Profit-Calculator
//
// Interaktiver Regler auf der Landing-Page. Drei Inputs (Listings / Conversion
// / Marge), Live-Output in Sales/Tag, €/Tag, €/Monat, €/Jahr. Drei Quick-
// Profile (Side-Hustler, Hauptberuf, Vollzeit) setzen die Slider auf
// realistische Sweet-Spots.
//
// Wichtig: keine Snake-Oil-Zahlen. Verteidige jede Annahme:
//   • Conversion 5–25%/Tag ist üblicher Range auf Vinted bei aktivem Repricing.
//   • Marge €8–15 sind die typischen CJ-Mode-EKs von €5–7 zu Vinted-VK €18–25.
//   • Volumen 10–500 Listings ist was du als Solo-Operator easy halten kannst —
//     darüber kommen Bann-Risiken + Account-Stretching ins Spiel.
// ──────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Sparkles, TrendingUp, Calendar, Wallet, Info } from 'lucide-react';

type PresetId = 'newbie' | 'starter' | 'sidehustler' | 'fulltime';

interface Preset {
  id: PresetId;
  label: string;
  hint: string;
  listings: number;
  conversionPct: number;
  marginEur: number;
}

const PRESETS: Preset[] = [
  { id: 'newbie',      label: 'Woche 1 (Cold-Start)', hint: 'neuer Account, rate-limited', listings: 30,  conversionPct: 3,  marginEur: 10 },
  { id: 'starter',     label: 'Einsteiger',   hint: 'erste Wochen, Account warm',   listings: 50,  conversionPct: 12, marginEur: 9 },
  { id: 'sidehustler', label: 'Side-Hustler', hint: 'feste Nebeneinkunft',           listings: 100, conversionPct: 8,  marginEur: 10 },
  { id: 'fulltime',    label: 'Vollzeit',     hint: 'mehrere Accounts, Skaliert',    listings: 500, conversionPct: 12, marginEur: 11 },
];

function fmtEur(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: fractionDigits }).format(n);
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('de-DE').format(Math.round(n));
}

export function ProfitCalculator() {
  const [listings, setListings] = useState(150);
  const [conversionPct, setConversionPct] = useState(14);
  const [marginEur, setMarginEur] = useState(10);
  const [active, setActive] = useState<PresetId | null>('sidehustler');

  const numbers = useMemo(() => {
    const salesPerDay = listings * (conversionPct / 100);
    const profitPerDay = salesPerDay * marginEur;
    const profitPerMonth = profitPerDay * 30;
    const profitPerYear = profitPerDay * 365;
    return {
      salesPerDay,
      profitPerDay,
      profitPerMonth,
      profitPerYear,
      revenue: salesPerDay * (marginEur * 2.6), // rough VK-est (3× cost)
    };
  }, [listings, conversionPct, marginEur]);

  function applyPreset(p: Preset) {
    setListings(p.listings);
    setConversionPct(p.conversionPct);
    setMarginEur(p.marginEur);
    setActive(p.id);
  }

  function onSlide<T extends number>(fn: (v: T) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      fn(Number(e.target.value) as T);
      setActive(null);
    };
  }

  return (
    <section className="relative py-24 sm:py-28">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-40" />
      <div className="pointer-events-none absolute left-1/2 top-1/4 -z-10 h-[420px] w-[700px] -translate-x-1/2 rounded-full bg-ruby-500/10 blur-[120px]" />

      <div className="container-narrow">
        <div className="mb-12 text-center">
          <span className="eyebrow"><Sparkles size={12} /> Rechne nach</span>
          <h2 className="h-display mt-5">
            Was verdienst du?{' '}
            <span className="gradient-text">Schieb den Regler.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
            20 Sales pro Tag = <span className="font-bold text-zinc-100">200 € Gewinn täglich</span>. Easy machbar mit 100–150
            aktiven Listings. Nach oben offen — Volumen ist der einzige Hebel.
          </p>
        </div>

        {/* Preset chips */}
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                active === p.id
                  ? 'border-ruby-500/50 bg-ruby-500/15 text-white'
                  : 'border-white/10 bg-white/[0.02] text-zinc-300 hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              <span>{p.label}</span>
              <span className="text-[11px] font-normal text-zinc-500">· {p.hint}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          {/* Sliders */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-7 backdrop-blur">
            <SliderRow
              label="Aktive Listings"
              hint="Neue Accounts: 10–50 / Nach Warmup: 100–300. Solo-Operator schafft langfristig locker bis ~300."
              value={listings}
              min={10}
              max={500}
              step={10}
              unit=""
              onChange={onSlide<number>(setListings)}
            />
            <SliderRow
              label="Sales-Rate pro Tag"
              hint="Übliche Vinted-Conversion bei aktivem Re-Pricing: 10–18% deiner Listings pro Tag."
              value={conversionPct}
              min={5}
              max={25}
              step={1}
              unit="%"
              onChange={onSlide<number>(setConversionPct)}
            />
            <SliderRow
              label="Marge pro Verkauf"
              hint="VK − CJ-EK − Vinted-Provision (~5%) − Versand. Bei Klamotten typisch 8–13 €."
              value={marginEur}
              min={5}
              max={20}
              step={1}
              unit=" €"
              onChange={onSlide<number>(setMarginEur)}
            />

            <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-[11px] text-zinc-500">
              <Info size={13} className="mt-0.5 shrink-0 text-zinc-600" />
              <span>
                Realistische Annahmen aus unseren Beta-Tests (Q1–Q2 2026). Conversion sinkt anfangs (Account-Warmup),
                stabilisiert sich nach 7–14 Tagen. Vinted-Bann-Risiko unter 1 % bei Standard-Settings.
              </span>
            </div>

            <div
              style={{
                marginTop: 24,
                padding: 12,
                borderRadius: 8,
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#fcd34d',
                fontSize: 13,
              }}
            >
              <strong>⚠ Realistische Erwartungen:</strong> Neue Vinted-Accounts werden in Woche 1
              rate-limited (~5–10 publishbare Listings/Tag) und haben 2–5 % Conversion (nicht 8–14 %).
              Erwarte 20–50 €/Tag in Woche 1, 80–150 €/Tag nach 4 Wochen Account-Warmup. Die obigen
              Zahlen gelten für <strong>etablierte Seller mit Reputation</strong>.
            </div>
          </div>

          {/* Live Output */}
          <div className="relative overflow-hidden rounded-2xl border border-ruby-500/30 bg-gradient-to-br from-ruby-500/[0.10] via-ruby-500/[0.04] to-transparent p-7">
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-ruby-500/20 blur-3xl" />

            <div className="relative">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ruby-300/80">
                Dein Verdienst
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="display tabular text-[5rem] font-extrabold leading-none text-white">
                  {fmtEur(numbers.profitPerDay)}
                </span>
                <span className="text-lg font-semibold text-zinc-400">/ Tag</span>
              </div>
              <div className="mt-1.5 text-sm text-zinc-400">
                <span className="font-bold text-zinc-200 tabular">{fmtNum(numbers.salesPerDay)}</span> Verkäufe pro Tag
                {' · '}
                <span className="font-semibold text-zinc-300 tabular">{fmtEur(numbers.revenue)}</span> Umsatz
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3">
                <ResultTile
                  icon={Calendar}
                  label="pro Monat"
                  value={fmtEur(numbers.profitPerMonth)}
                  sub={`${fmtNum(numbers.salesPerDay * 30)} Sales`}
                />
                <ResultTile
                  icon={TrendingUp}
                  label="pro Jahr"
                  value={fmtEur(numbers.profitPerYear)}
                  sub={`${fmtNum(numbers.salesPerDay * 365)} Sales`}
                  highlight
                />
              </div>

              <div className="mt-6 flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2.5 text-[11px] text-zinc-400">
                <Wallet size={13} className="text-ruby-400" />
                <span>
                  Nach Steuer (~25 % Kleinunternehmer) bleiben{' '}
                  <span className="font-bold text-white tabular">
                    {fmtEur(numbers.profitPerMonth * 0.75)}
                  </span>{' '}
                  netto pro Monat in der Hand.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Volume scaling note */}
        <div className="mx-auto mt-12 max-w-3xl text-center text-sm text-zinc-500">
          <span className="font-semibold text-zinc-300">Volumen ist der einzige Hebel:</span>{' '}
          Verdoppelst du die Listings und behältst Marge + Conversion, verdoppelst du den Gewinn.
          Nach oben ist alles offen — wer 1.000 Listings auf 3 Accounts hält, dem geht nichts mehr an Free Cash vorbei.
        </div>
      </div>
    </section>
  );
}

function SliderRow({
  label, hint, value, min, max, step, unit, onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="mb-7 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label className="text-sm font-semibold text-zinc-200">{label}</label>
        <span className="tabular text-lg font-bold text-white">
          {value}
          <span className="text-sm font-normal text-zinc-500">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        className="slider-ruby w-full"
      />
      <div className="mt-1.5 text-[11px] text-zinc-500">{hint}</div>
    </div>
  );
}

function ResultTile({
  icon: Icon, label, value, sub, highlight,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? 'border-ruby-500/40 bg-ruby-500/[0.08]'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <Icon size={11} />
        {label}
      </div>
      <div className="mt-1.5 tabular text-2xl font-bold text-white">{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500 tabular">{sub}</div>
    </div>
  );
}
