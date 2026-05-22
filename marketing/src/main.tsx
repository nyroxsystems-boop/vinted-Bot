import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { LandingPage } from './pages/Landing';
import { PricingPage } from './pages/Pricing';
import { MembersPage } from './pages/Members';
import { LoginPage } from './pages/Login';
import { CheckoutSuccessPage } from './pages/CheckoutSuccess';
import { DownloadsPage } from './pages/Downloads';
import { LegalPage } from './pages/Legal';
import { DesktopLinkPage } from './pages/DesktopLink';
import './styles.css';

// Google OAuth client ID — public info, embedded in every Google-OAuth-
// using site. We fetch it at runtime from /api/config/public rather than
// baking it in via VITE_GOOGLE_CLIENT_ID at build time, because Railway
// only had GOOGLE_CLIENT_ID set (server-side) and the duplicate Vite
// build-time var was easy to forget. Runtime fetch = one source of truth.
//
// `VITE_GOOGLE_CLIENT_ID` is still honoured as a build-time override for
// local dev or self-hosted deployments that prefer baked config.

const root = ReactDOM.createRoot(document.getElementById('root')!);

async function bootstrap() {
  const buildTimeId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
  let clientId = buildTimeId;
  if (!clientId) {
    try {
      const r = await fetch('/api/config/public');
      const data = await r.json();
      if (data?.google_client_id) clientId = data.google_client_id;
    } catch (e) {
      console.error('[bootstrap] failed to fetch /api/config/public — Google login will be unavailable:', e);
    }
  }
  // Always render — even with empty clientId — so the rest of the site
  // works. The Google button will be visibly broken (Google iframe errors
  // in the console) but everything else keeps functioning.
  root.render(
    <React.StrictMode>
      <GoogleOAuthProvider clientId={clientId}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/success" element={<CheckoutSuccessPage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/desktop-link" element={<DesktopLinkPage />} />
            <Route path="/legal/:doc" element={<LegalPage />} />
          </Routes>
        </BrowserRouter>
      </GoogleOAuthProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
