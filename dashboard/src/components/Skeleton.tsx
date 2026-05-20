// Reusable skeleton primitives. Use these instead of "Lädt..." text so the
// page reserves the right layout space and the perceived load time drops.

interface BoxProps {
  className?: string;
}

export function SkeletonBox({ className = '' }: BoxProps) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonLine({ width = 'w-full' }: { width?: string }) {
  return <div className={`skeleton h-3 ${width}`} />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 ? 'w-3/4' : 'w-full'} />
      ))}
    </div>
  );
}

export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-${count} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <SkeletonLine width="w-20" />
          <div className="mt-3 skeleton h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="skeleton aspect-[3/4] -mx-5 -mt-5" />
          <div className="mt-3 space-y-2">
            <SkeletonLine width="w-3/4" />
            <SkeletonLine width="w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-100">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
    </div>
  );
}
