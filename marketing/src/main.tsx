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
import './styles.css';

// VITE_GOOGLE_CLIENT_ID is the OAuth client ID created at
// console.cloud.google.com (Web Application credential). The id is public
// — it's embedded in the client bundle and works alongside Google's
// origin/redirect-URI allowlist. Server verifies the token before
// trusting anything.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/success" element={<CheckoutSuccessPage />} />
          <Route path="/downloads" element={<DownloadsPage />} />
          <Route path="/legal/:doc" element={<LegalPage />} />
        </Routes>
      </BrowserRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
