import { Link, useLocation } from 'react-router-dom';
import { Logo } from './Logo';

export function Nav() {
  const { pathname } = useLocation();
  const link = (to: string, label: string) => (
    <Link
      to={to}
      className={`text-sm font-medium transition ${
        pathname === to ? 'text-white' : 'text-zinc-400 hover:text-white'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/70 backdrop-blur-xl">
      <div className="container-narrow flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="font-display text-base font-bold tracking-tight text-white">
            Blackruby
          </span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {link('/', 'Übersicht')}
          {link('/pricing', 'Preise')}
          {link('/downloads', 'Download')}
          {link('/members', 'Mitglieder')}
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/members" className="btn-ghost hidden md:inline-flex">
            Login
          </Link>
          <Link to="/pricing" className="btn-primary">
            Jetzt starten
          </Link>
        </div>
      </div>
    </header>
  );
}
