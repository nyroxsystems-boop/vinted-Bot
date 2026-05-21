// Reveal — scroll-triggered fade-up wrapper.
//
// IntersectionObserver-based. The first time the wrapped node enters the
// viewport (with a small bottom margin so it fires slightly before the
// element is fully visible) it gets the `is-revealed` class which triggers
// the CSS transition. Once revealed, the observer is disconnected — we
// never re-hide. Components that mount already in-viewport (e.g. the hero
// on first load) get revealed on the next animation frame to avoid the
// "blank first paint" flash.

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  delay?: number;          // ms — staggered reveals within a section
  as?: 'div' | 'section' | 'article';
  className?: string;
  y?: number;              // px — translate distance, default 24
  duration?: number;       // ms — transition length, default 700
}

export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
  y = 24,
  duration = 700,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    // Reduced-motion users get an instant reveal — no transition, no observer.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            // Stagger inside an rAF to avoid layout thrash when many
            // reveals fire at the same scroll position.
            requestAnimationFrame(() => setShown(true));
            obs.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={className}
      style={{
        transform: shown ? 'translateY(0)' : `translateY(${y}px)`,
        opacity: shown ? 1 : 0,
        transition: `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, opacity ${duration}ms ease-out ${delay}ms`,
        willChange: shown ? undefined : 'transform, opacity',
      }}
    >
      {children}
    </Tag>
  );
}
