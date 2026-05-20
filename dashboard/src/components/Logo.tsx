// Blackruby brand logo — a stylized ruby/diamond silhouette with a ruby→indigo
// gradient. Rendered as inline SVG so it scales crisp at any size and recolours
// cleanly against dark or light surfaces.

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Blackruby"
      fill="none"
    >
      <defs>
        <linearGradient id="brLogoGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="55%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id="brLogoHighlight" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Dark rounded plate */}
      <rect x="2" y="2" width="44" height="44" rx="12" fill="#0a0a0c" stroke="rgba(255,255,255,0.08)" />

      {/* Ruby silhouette — angular gem cut */}
      <path
        d="M16 14 L32 14 L38 22 L24 40 L10 22 Z"
        fill="url(#brLogoGrad)"
      />

      {/* Top facet highlight */}
      <path
        d="M16 14 L32 14 L24 22 Z"
        fill="rgba(255,255,255,0.22)"
      />

      {/* Left facet shadow */}
      <path
        d="M16 14 L24 22 L10 22 Z"
        fill="rgba(0,0,0,0.20)"
      />

      {/* Right facet shadow */}
      <path
        d="M32 14 L38 22 L24 22 Z"
        fill="rgba(0,0,0,0.12)"
      />

      {/* Glossy top sheen */}
      <path
        d="M16 14 L32 14 L29 16 L19 16 Z"
        fill="url(#brLogoHighlight)"
      />
    </svg>
  );
}

export function LogoMark({ size = 24 }: { size?: number }) {
  // Compact version — used on dark headers where the plate would be redundant.
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="brMarkGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path
        d="M14 12 L34 12 L42 22 L24 44 L6 22 Z"
        fill="url(#brMarkGrad)"
      />
    </svg>
  );
}
