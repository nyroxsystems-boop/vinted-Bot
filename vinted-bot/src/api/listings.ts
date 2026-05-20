// ──────────────────────────────────────────────────────────────────────────────
// Vinted Listing API: create / update / delete
//
// Endpoint-Muster (v2):
//   POST   /api/v2/items            { item: { title, description, ... } }
//   PUT    /api/v2/items/{id}       { item: { ...partial } }
//   DELETE /api/v2/items/{id}
//
// Vinted's Item-Body hat ungefähr (verifiziert aus diversen open-source Tools):
//   {
//     "item": {
//       "title", "description", "price",
//       "currency": "EUR",
//       "catalog_id": <leaf-cat-id>,
//       "brand_id"?: <id> | "brand": "<freitext>",
//       "is_unisex": 0,
//       "size_id"?: <id>,
//       "color_ids": [<id>, ...],
//       "material_ids": [<id>, ...],
//       "status_id": <state-id>,
//       "package_size_id": <1|2|3>,                       // 1=Klein, 2=Mittel, 3=Groß
//       "assigned_photos": [{"id": ...} | {"temp_uuid": ...}, ...]
//     }
//   }
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import type { VintedApi } from './client.js';
import { VintedLookups } from './lookups.js';
import type { UploadedPhoto } from './photos.js';

const log = createLogger('vinted-api-listings');

export interface ApiCreateInput {
  title: string;
  description: string;
  price: number;
  category: string;       // "Damen > Kleider > Minikleider"
  brand: string;          // "Ohne Marke" → wird zu is_unisex=0 + no brand_id
  size: string;
  condition: string;
  color: string;          // comma-separated "Schwarz, Weiß"
  material?: string;
  shipping?: string;      // "Klein"|"Mittel"|"Groß"
  photos: UploadedPhoto[];
}

export interface ApiCreateResult {
  ok: boolean;
  itemId?: number;
  url?: string;
  error?: string;
  warnings?: string[];
}

const SHIPPING_MAP: Record<string, number> = { 'Klein': 1, 'Mittel': 2, 'Groß': 3 };

export async function createListingViaApi(
  api: VintedApi,
  lookups: VintedLookups,
  input: ApiCreateInput,
): Promise<ApiCreateResult> {
  const warnings: string[] = [];

  // Lookups parallel
  const [catalogId, brandId, stateId, materialId, colorIds] = await Promise.all([
    lookups.findCategoryId(input.category),
    lookups.findBrandId(input.brand),
    lookups.findStateId(input.condition),
    input.material ? lookups.findMaterialId(input.material) : Promise.resolve(null),
    lookups.findColorIds(input.color.split(',').map((c) => c.trim()).filter(Boolean)),
  ]);

  if (!catalogId) return { ok: false, error: `category not found via API: ${input.category}` };
  if (!stateId) warnings.push(`condition "${input.condition}" not matched — using fallback`);

  // Größe ist categoy-abhängig
  const sizeId = await lookups.findSizeId(catalogId, input.size).catch(() => null);
  if (!sizeId) warnings.push(`size "${input.size}" not matched for category ${catalogId}`);

  const assignedPhotos = input.photos.map((p) =>
    p.id ? { id: p.id } : p.temp_uuid ? { temp_uuid: p.temp_uuid } : null,
  ).filter((x): x is { id: number } | { temp_uuid: string } => x !== null);

  if (assignedPhotos.length === 0) return { ok: false, error: 'no usable photos (no IDs/UUIDs)' };

  const item: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    price: input.price.toFixed(2),
    currency: 'EUR',
    catalog_id: catalogId,
    is_unisex: 0,
    color_ids: colorIds,
    assigned_photos: assignedPhotos,
  };
  if (brandId) item.brand_id = brandId;
  else if (input.brand && input.brand !== 'Ohne Marke') item.brand = input.brand;
  if (sizeId) item.size_id = sizeId;
  if (stateId) item.status_id = stateId;
  if (materialId) item.material_ids = [materialId];
  if (input.shipping && SHIPPING_MAP[input.shipping]) {
    item.package_size_id = SHIPPING_MAP[input.shipping];
  }

  log.info('Creating item via API', {
    title: input.title.slice(0, 60),
    catalog_id: catalogId,
    photos: assignedPhotos.length,
    has_brand_id: !!brandId,
    has_size_id: !!sizeId,
  });

  try {
    const result = await api.post<{ item?: { id: number; url?: string }; id?: number; url?: string }>(
      '/api/v2/items',
      { item },
      { timeoutMs: 60_000, retryAttempts: 2 },
    );
    const itemId = result.item?.id ?? result.id;
    const url = result.item?.url ?? result.url;
    if (!itemId) {
      log.warn('item created but no id in response', { result });
      return { ok: false, error: 'API returned no item id', warnings };
    }
    return { ok: true, itemId, url, warnings };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      warnings,
    };
  }
}

export async function updateItemPriceViaApi(
  api: VintedApi,
  itemId: number,
  newPriceEur: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.put(`/api/v2/items/${itemId}`, {
      item: { price: newPriceEur.toFixed(2), currency: 'EUR' },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteItemViaApi(
  api: VintedApi,
  itemId: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.delete(`/api/v2/items/${itemId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
