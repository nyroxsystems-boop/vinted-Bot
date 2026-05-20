import { Link } from 'react-router-dom';
import { Logo } from './Logo';

export function Footer() {
  return (
    <footer className="mt-32 border-t border-white/5 py-12">
      <div className="container-narrow flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <Logo size={24} />
            <span className="font-display text-sm font-bold text-white">Blackruby</span>
          </div>
          <p className="max-w-xs text-xs text-zinc-500">
            Autonome Crosslisting-Engine für 21 Marktplätze. Lokale Software, keine Cloud-Abhängigkeit.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
          <FootCol title="Produkt" links={[
            { to: '/', label: 'Übersicht' },
            { to: '/pricing', label: 'Preise' },
            { to: '/downloads', label: 'Download' },
          ]} />
          <FootCol title="Mitglieder" links={[
            { to: '/members', label: 'Lizenz-Login' },
            { to: '/members', label: 'Mein Key' },
          ]} />
          <FootCol title="Rechtliches" links={[
            { to: '/legal/agb', label: 'AGB' },
            { to: '/legal/datenschutz', label: 'Datenschutz' },
            { to: '/legal/impressum', label: 'Impressum' },
          ]} />
        </div>
      </div>

      <div className="container-narrow mt-10 flex flex-col gap-2 border-t border-white/5 pt-6 text-xs text-zinc-600 md:flex-row md:items-center md:justify-between">
        <span>© {new Date().getFullYear()} Blackruby Systems. Alle Rechte vorbehalten.</span>
        <span className="font-mono">v0.5 — Hustle Engine</span>
      </div>
    </footer>
  );
}

function FootCol({ title, links }: { title: string; links: Array<{ to: string; label: string }> }) {
  return (
    <div>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            <Link to={l.to} className="text-zinc-400 transition hover:text-white">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
