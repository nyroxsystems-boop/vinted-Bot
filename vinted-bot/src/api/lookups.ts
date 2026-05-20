// ──────────────────────────────────────────────────────────────────────────────
// Vinted-API Lookups: Name → ID
//
// Vinted-API erwartet IDs für Brands, Colors, Sizes, Categories statt Strings.
// Wir lookup'en per Name und cachen in-Memory pro Session.
// Bekannte Endpoints (v2):
//   GET /api/v2/brands?keyword=Zara
//   GET /api/v2/catalogs                 — Kategoriebaum
//   GET /api/v2/colours                  — Farben
//   GET /api/v2/material_groups          — Materialien
//   GET /api/v2/categories/{cat_id}/sizes — Größen pro Kategorie
//   GET /api/v2/items/states             — Zustände
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import type { VintedApi } from './client.js';

const log = createLogger('vinted-api-lookups');

interface NamedEntity { id: number; title?: string; name?: string; code?: string }

function entityName(e: NamedEntity): string {
  return (e.title ?? e.name ?? '').toLowerCase();
}

function bestMatch<T extends NamedEntity>(items: T[], query: string): T | null {
  if (items.length === 0) return null;
  const q = query.toLowerCase().trim();
  // exakter Match
  const exact = items.find((i) => entityName(i) === q);
  if (exact) return exact;
  // contains
  const contains = items.find((i) => entityName(i).includes(q) || q.includes(entityName(i)));
  return contains ?? null;
}

export class VintedLookups {
  private brands = new Map<string, number>();
  private colors: NamedEntity[] | null = null;
  private materials: NamedEntity[] | null = null;
  private states: NamedEntity[] | null = null;
  private catalog: unknown[] | null = null;
  private sizesByCategory = new Map<number, NamedEntity[]>();

  constructor(private api: VintedApi) {}

  async findBrandId(name: string): Promise<number | null> {
    const key = name.trim().toLowerCase();
    if (!key || key === 'ohne marke' || key === 'no brand') return null; // Brand "Ohne Marke" wird via separates Flag gesetzt
    if (this.brands.has(key)) return this.brands.get(key)!;
    try {
      const r = await this.api.get<{ brands?: NamedEntity[] }>(`/api/v2/brands?keyword=${encodeURIComponent(name)}&page=1&per_page=10`);
      const list = r.brands ?? [];
      const match = bestMatch(list, name);
      if (match) {
        this.brands.set(key, match.id);
        return match.id;
      }
    } catch (err) {
      log.warn('brand lookup failed', { name, err: String(err) });
    }
    return null;
  }

  async findColorIds(names: string[]): Promise<number[]> {
    if (!this.colors) {
      try {
        const r = await this.api.get<{ colours?: NamedEntity[]; colors?: NamedEntity[] }>('/api/v2/colours');
        this.colors = r.colours ?? r.colors ?? [];
      } catch (err) {
        log.warn('colors lookup failed', { err: String(err) });
        this.colors = [];
      }
    }
    const ids: number[] = [];
    for (const n of names.slice(0, 2)) {
      const m = bestMatch(this.colors, n);
      if (m) ids.push(m.id);
    }
    return ids;
  }

  async findMaterialId(name: string): Promise<number | null> {
    if (!name) return null;
    if (!this.materials) {
      try {
        const r = await this.api.get<{ material_groups?: NamedEntity[]; materials?: NamedEntity[] }>('/api/v2/material_groups');
        this.materials = r.material_groups ?? r.materials ?? [];
      } catch (err) {
        log.warn('materials lookup failed', { err: String(err) });
        this.materials = [];
      }
    }
    return bestMatch(this.materials, name)?.id ?? null;
  }

  async findStateId(condition: string): Promise<number | null> {
    if (!this.states) {
      try {
        const r = await this.api.get<{ states?: NamedEntity[]; item_states?: NamedEntity[] }>('/api/v2/items/states');
        this.states = r.states ?? r.item_states ?? [];
      } catch (err) {
        log.warn('states lookup failed', { err: String(err) });
        this.states = [];
      }
    }
    return bestMatch(this.states, condition)?.id ?? null;
  }

  async findCategoryId(path: string): Promise<number | null> {
    // path: "Damen > Kleider > Minikleider"
    if (!this.catalog) {
      try {
        const r = await this.api.get<{ catalogs?: unknown[]; tree?: unknown[] }>('/api/v2/catalogs');
        this.catalog = (r.catalogs ?? r.tree ?? []) as unknown[];
      } catch (err) {
        log.warn('catalog lookup failed', { err: String(err) });
        this.catalog = [];
      }
    }
    return findCategoryRecursive(this.catalog, path.split('>').map((s) => s.trim()).filter(Boolean));
  }

  async findSizeId(categoryId: number, sizeName: string): Promise<number | null> {
    if (!this.sizesByCategory.has(categoryId)) {
      try {
        const r = await this.api.get<{ sizes?: NamedEntity[]; size_groups?: Array<{ sizes?: NamedEntity[] }> }>(`/api/v2/categories/${categoryId}/sizes`);
        const flat = r.sizes ?? r.size_groups?.flatMap((g) => g.sizes ?? []) ?? [];
        this.sizesByCategory.set(categoryId, flat);
      } catch (err) {
        log.warn('sizes lookup failed', { categoryId, err: String(err) });
        this.sizesByCategory.set(categoryId, []);
      }
    }
    const list = this.sizesByCategory.get(categoryId) ?? [];
    return bestMatch(list, sizeName)?.id ?? null;
  }
}

function findCategoryRecursive(tree: unknown[], pathParts: string[]): number | null {
  if (pathParts.length === 0) return null;
  const head = pathParts[0]!.toLowerCase();
  for (const node of tree) {
    if (!node || typeof node !== 'object') continue;
    const n = node as { id?: number; title?: string; name?: string; catalogs?: unknown[]; children?: unknown[] };
    const label = (n.title ?? n.name ?? '').toLowerCase();
    if (label === head || label.includes(head) || head.includes(label)) {
      if (pathParts.length === 1) return n.id ?? null;
      const children = n.catalogs ?? n.children ?? [];
      return findCategoryRecursive(children as unknown[], pathParts.slice(1));
    }
  }
  // Wenn nicht gefunden auf aktueller Ebene: in Children weitersuchen (Top-Down)
  for (const node of tree) {
    if (!node || typeof node !== 'object') continue;
    const n = node as { catalogs?: unknown[]; children?: unknown[] };
    const children = n.catalogs ?? n.children ?? [];
    const deep = findCategoryRecursive(children as unknown[], pathParts);
    if (deep !== null) return deep;
  }
  return null;
}
