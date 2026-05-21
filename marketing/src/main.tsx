import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/Landing';
import { PricingPage } from './pages/Pricing';
import { MembersPage } from './pages/Members';
import { LoginPage } from './pages/Login';
import { CheckoutSuccessPage } from './pages/CheckoutSuccess';
import { DownloadsPage } from './pages/Downloads';
import { LegalPage } from './pages/Legal';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>,
);
