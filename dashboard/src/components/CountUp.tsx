// Lightweight count-up animation for KPI numbers.
//
// Counts from the previous rendered value to the new one over `duration` ms
// using easeOutQuart. No external dep — uses rAF.

import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  duration?: number;
  format: (n: number) => string;
  className?: string;
}

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

export function CountUp({ value, duration = 700, format, className }: Props) {
  const [display, setDisplay] = useState<number>(value);
  const fromRef = useRef<number>(value);
  const startRef = useRef<number>(performance.now());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (fromRef.current === value) return;
    const from = fromRef.current;
    startRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutQuart(t);
      const next = from + (value - from) * eased;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <span className={className}>{format(display)}</span>;
}
