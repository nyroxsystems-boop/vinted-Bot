import { Route, Routes, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { OverviewPage } from './pages/Overview';
import { ListingsPage } from './pages/Listings';
import { OffersPage } from './pages/Offers';
import { OrdersPage } from './pages/Orders';
import { ChatsPage } from './pages/Chats';
import { LogsPage } from './pages/Logs';
import { SettingsPage } from './pages/Settings';
import { FulfillmentPage } from './pages/Fulfillment';
import { AnalyticsPage } from './pages/Analytics';
import { CrawlerPage } from './pages/Crawler';

export function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-slate-50">
        <div className="mx-auto max-w-7xl p-6">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/fulfillment" element={<FulfillmentPage />} />
            <Route path="/crawler" element={<CrawlerPage />} />
            <Route path="/listings" element={<ListingsPage />} />
            <Route path="/offers" element={<OffersPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/chats" element={<ChatsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
