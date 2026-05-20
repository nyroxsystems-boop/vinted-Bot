export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="60%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill="#0a0a0c" stroke="rgba(255,255,255,0.08)" />
      <path d="M22 18 L42 18 L48 28 L32 50 L16 28 Z" fill="url(#logoGrad)" />
      <path d="M22 18 L42 18 L32 28 Z" fill="rgba(255,255,255,0.18)" />
      <path d="M22 18 L32 28 L16 28 Z" fill="rgba(0,0,0,0.18)" />
      <path d="M42 18 L48 28 L32 28 Z" fill="rgba(0,0,0,0.12)" />
    </svg>
  );
}
