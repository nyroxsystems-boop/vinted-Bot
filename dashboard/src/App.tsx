import { useState } from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MarketplaceProvider } from './components/MarketplaceContext';
import { LicenseProvider } from './license/LicenseProvider';
import { Onboarding, shouldShowOnboarding } from './onboarding/Onboarding';
import { ToastViewport } from './components/Toast';
import { CommandPalette } from './components/CommandPalette';
// UpdateChecker (old toast-only checker) wurde durch UpdateBanner ersetzt —
// der neue Tauri-Tarball-Updater übernimmt jetzt Detection + Apply in einem Flow.
// import { UpdateChecker } from './components/UpdateChecker';
import { HomePage } from './pages/Home';
import { VerkaufPage } from './pages/Verkauf';
import { AutoListingsPage } from './pages/AutoListings';
import { ListingsGridPage } from './pages/ListingsGrid';
import { SettingsPage } from './pages/Settings';
// Legacy pages — kept routable as deep links (sidebar slim now) so existing
// tools/bookmarks keep working. Hidden from sidebar.
import { OverviewPage } from './pages/Overview';
import { ListingsPage } from './pages/Listings';
import { OffersPage } from './pages/Offers';
import { OrdersPage } from './pages/Orders';
import { ChatsPage } from './pages/Chats';
import { LogsPage } from './pages/Logs';
import { FulfillmentPage } from './pages/Fulfillment';
import { AnalyticsPage } from './pages/Analytics';
import { CrawlerPage } from './pages/Crawler';
import { ServicesPage } from './pages/Services';
import { PurchaseQueuePage } from './pages/PurchaseQueue';
import { AccountsPage } from './pages/Accounts';
import { ProductsPage } from './pages/Products';
import { ProductDetailPage } from './pages/ProductDetail';
import { MarketplacePage } from './pages/Marketplace';
import { CJOrdersPage } from './pages/CJOrders';
import { CJProductsPage } from './pages/CJProducts';
import { ProfitDashboard } from './pages/ProfitDashboard';
import { PlatformOverview } from './pages/PlatformOverview';
import { CrosslistPage } from './pages/Crosslist';
import { PipelinePage } from './pages/Pipeline';
import { ModelStudioPage } from './pages/ModelStudio';
import { SceneStudioPage } from './pages/SceneStudio';
import { TrendsPage } from './pages/Trends';
import { RefundsPage } from './pages/Refunds';
import OperationsPage from './pages/Operations';
import { PauseBanner } from './components/PauseBanner';
import { OrchestratorHealthBanner } from './components/OrchestratorHealthBanner';
import { ConfigHealthBanner } from './components/ConfigHealthBanner';
import { UpdateBanner } from './components/UpdateBanner';

export function App() {
  // VITE_BYPASS_LICENSE=true in .env.local skips the license gate (dev only).
  const bypassLicense = import.meta.env.VITE_BYPASS_LICENSE === 'true';
  return (
    <LicenseProvider bypass={bypassLicense}>
      <MarketplaceProvider>
        <AppInner />
        <ToastViewport />
      </MarketplaceProvider>
    </LicenseProvider>
  );
}

function AppInner() {
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding());
  const location = useLocation();
  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {onboardingOpen && <Onboarding onDone={() => setOnboardingOpen(false)} />}
      <CommandPalette />
      <Sidebar />
      <div className="flex flex-1 min-w-0 flex-col">
        <OrchestratorHealthBanner />
        <UpdateBanner />
        <ConfigHealthBanner />
        <PauseBanner />
        <main className="flex-1 overflow-y-auto">
        <div key={location.pathname} className="route-fade mx-auto max-w-7xl p-8">
          <ErrorBoundary>
            <Routes>
              {/* ── New 4-page nav ───────────────────────────────── */}
              <Route path="/" element={<HomePage />} />
              <Route path="/listings" element={<ListingsGridPage />} />
              <Route path="/verkauf" element={<VerkaufPage />} />
              <Route path="/settings" element={<SettingsPage />} />

              {/* ── Legacy deep links (still reachable, hidden from nav) ──── */}
              <Route path="/home" element={<HomePage />} />
              <Route path="/platforms" element={<PlatformOverview />} />
              <Route path="/pipeline" element={<PipelinePage />} />
              <Route path="/studio" element={<ModelStudioPage />} />
              <Route path="/scenes" element={<SceneStudioPage />} />
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/:folderNum" element={<ProductDetailPage />} />
              <Route path="/fulfillment" element={<FulfillmentPage />} />
              <Route path="/purchase-queue" element={<PurchaseQueuePage />} />
              <Route path="/crawler" element={<CrawlerPage />} />
              <Route path="/auto-listings" element={<AutoListingsPage />} />
              <Route path="/live-listings" element={<ListingsPage />} />
              <Route path="/offers" element={<OffersPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/chats" element={<ChatsPage />} />
              <Route path="/marketplace/:mp" element={<MarketplacePage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/services" element={<ServicesPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/cj/orders" element={<CJOrdersPage />} />
              <Route path="/cj/products" element={<CJProductsPage />} />
              <Route path="/profit" element={<ProfitDashboard />} />
              <Route path="/crosslist" element={<CrosslistPage />} />
              <Route path="/trends" element={<TrendsPage />} />
              <Route path="/refunds" element={<RefundsPage />} />
              <Route path="/operations" element={<OperationsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </div>
        </main>
      </div>
    </div>
  );
}
