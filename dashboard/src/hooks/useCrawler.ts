import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export interface CrawlerFilters {
  min_rating: number;
  min_reviews: number;
  max_price_eur: number;
  max_per_query: number;
}

export interface CrawlerPreset {
  name: string;
  label: string;
  queries: string[];
}

export interface CrawlerPresetsBundle {
  default_filters: CrawlerFilters;
  presets: CrawlerPreset[];
}

export interface CrawledProduct {
  id: number;
  temu_goods_id: string;
  temu_url: string;
  title: string | null;
  price_eur: number | null;
  rating: number | null;
  review_count: number | null;
  search_query: string | null;
  folder_num: number | null;
  folder_path: string | null;
  status: string;
  crawled_at: string;
}

export function usePresets() {
  const [data, setData] = useState<CrawlerPresetsBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<CrawlerPresetsBundle>('/crawler/presets')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return { data, error };
}

export function useCrawledProducts(pollMs = 10_000) {
  const [products, setProducts] = useState<CrawledProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setProducts(await api.get<CrawledProduct[]>('/crawler/products'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { products, loading, reload };
}

export async function runCrawl(body: {
  queries: string[];
  filters?: Partial<CrawlerFilters>;
  presetName?: string;
}) {
  return api.post<{
    ok: boolean;
    results: Array<{
      query: string;
      candidates: number;
      kept: number;
      errors: number;
      products: Array<{ goods_id: string; folder_num: number; folder_path: string }>;
    }>;
  }>('/crawler/run', body);
}
