import { Link, useLocation } from 'react-router-dom';
import { User } from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '../lib/auth';

export function Nav() {
  const { pathname } = useLocation();
  const { user, ready } = useAuth();

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
          {user && link('/members', 'Mitglieder')}
        </nav>
        <div className="flex items-center gap-3">
          {ready && user ? (
            <Link
              to="/members"
              className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.06] md:inline-flex"
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-ruby-500 to-indigo-500 text-[10px] font-bold text-white">
                {user.email.charAt(0).toUpperCase()}
              </span>
              <span className="max-w-[140px] truncate font-mono text-[11px] normal-case">{user.email}</span>
            </Link>
          ) : (
            <Link to="/login" className="btn-ghost hidden md:inline-flex">
              <User size={14} /> Login
            </Link>
          )}
          <Link to="/pricing" className="btn-primary">
            Jetzt starten
          </Link>
        </div>
      </div>
    </header>
  );
}
