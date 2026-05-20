// ──────────────────────────────────────────────────────────────────────────────
// CJ Dropshipping API v2.0 Client
//
// Pure HTTP client — no browser, no Playwright.
// Docs: https://developers.cjdropshipping.com/en/api/introduction.html
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, bumpCjApiCall } from '@vinted-system/shared';

const log = createLogger('cj-client');

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

// ISO-2 country code → full name (CJ V2 requires both for createOrder)
const COUNTRY_NAME: Record<string, string> = {
  DE: 'Germany', AT: 'Austria', CH: 'Switzerland',
  FR: 'France', IT: 'Italy', ES: 'Spain', PT: 'Portugal',
  NL: 'Netherlands', BE: 'Belgium', LU: 'Luxembourg',
  UK: 'United Kingdom', GB: 'United Kingdom', IE: 'Ireland',
  DK: 'Denmark', SE: 'Sweden', NO: 'Norway', FI: 'Finland',
  PL: 'Poland', CZ: 'Czech Republic', SK: 'Slovakia', HU: 'Hungary',
  US: 'United States', CA: 'Canada', AU: 'Australia',
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface CJProduct {
  pid: string;
  productName: string;
  productNameEn: string;
  productImage: string;
  categoryId: string;
  categoryName: string;
  sellPrice: number;
  productWeight: number;
  productUnit: string;
  productSku?: string;
  variants: CJVariant[];
}

export interface CJVariant {
  vid: string;
  variantName: string;
  variantNameEn: string;
  variantImage: string;
  variantSku: string;
  sellPrice: number;
  variantProperty: Array<{ propName: string; propValue: string }>;
}

export interface CJProductDetail extends CJProduct {
  description: string;
  materialName: string;
  packingWeight: number;
  sourceFrom: number; // 1=1688, 2=CJ
  variants: CJVariant[];
}

export interface CJOrderInput {
  orderNumber: string;
  shippingCustomerName: string;
  shippingCountryCode: string;
  shippingProvince: string;
  shippingCity: string;
  shippingAddress: string;
  shippingZip: string;
  shippingPhone: string;
  fromCountryCode?: string;   // Source warehouse country (default CN)
  products: Array<{
    vid: string;
    quantity: number;
  }>;
  logisticName?: string;
  remark?: string;
}

export interface CJOrderResult {
  orderId: string;
  orderNumber: string;
  cjOrderId: string;
}

export interface CJTrackingInfo {
  trackingNumber: string;
  logisticName: string;
  trackDetails: Array<{
    date: string;
    info: string;
  }>;
}

export interface CJLogisticOption {
  logisticName: string;
  logisticPrice: number;
  logisticAging: string; // e.g. "7-15 business days"
}

interface CJApiResponse<T> {
  code: number;
  result: boolean;
  message: string;
  data: T;
  requestId: string;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class CJClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private email: string;
  private password: string;

  constructor(email: string, password: string) {
    this.email = email;
    this.password = password;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    return this.refreshToken();
  }

  async refreshToken(): Promise<string> {
    log.info('Refreshing CJ access token');
    const res = await this.rawRequest<{ accessToken: string; accessTokenExpiryDate: string }>(
      'POST',
      '/authentication/getAccessToken',
      { email: this.email, password: this.password },
    );
    this.accessToken = res.accessToken;
    // Token expires in ~24h, refresh 1h early
    this.tokenExpiresAt = new Date(res.accessTokenExpiryDate).getTime() - 3600_000;
    log.info('CJ token acquired', { expiresAt: res.accessTokenExpiryDate });
    return this.accessToken;
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async searchProducts(keyword: string, opts?: {
    categoryId?: string;
    pageNum?: number;
    pageSize?: number;
    countryCode?: string;
    minPrice?: number;
    maxPrice?: number;
  }): Promise<CJProduct[]> {
    const params = new URLSearchParams({
      keyWord: keyword,
      pageNum: String(opts?.pageNum ?? 1),
      pageSize: String(opts?.pageSize ?? 20),
    });
    if (opts?.categoryId) params.set('categoryId', opts.categoryId);
    if (opts?.countryCode) params.set('countryCode', opts.countryCode);
    if (opts?.minPrice) params.set('startPrice', String(opts.minPrice));
    if (opts?.maxPrice) params.set('endPrice', String(opts.maxPrice));

    // CJ's listV2 response shape (verified live 2026-05-19):
    //   data: { content: [ { productList: [{ id, nameEn, sellPrice, bigImage, … }] } ],
    //           totalRecords, pageNumber, pageSize, totalPages }
    // The product fields use V2 names that differ from the legacy V1 fields
    // (`id`/`nameEn`/`bigImage` vs old `pid`/`productName`/`productImage`),
    // so we normalize here into the CJProduct shape downstream code expects.
    interface ListV2Raw {
      content?: Array<{ productList?: Array<Record<string, unknown>> }>;
      totalRecords?: number;
    }
    const raw = await this.get<ListV2Raw>(`/product/listV2?${params}`);
    const flat = (raw.content ?? []).flatMap((c) => c.productList ?? []);
    return flat.map((r) => ({
      pid: String(r.id ?? r.pid ?? ''),
      productName: String(r.nameEn ?? r.productName ?? ''),
      productNameEn: String(r.nameEn ?? r.productNameEn ?? ''),
      productImage: String(r.bigImage ?? r.productImage ?? ''),
      categoryId: String(r.categoryId ?? ''),
      categoryName: String(r.threeCategoryName ?? r.twoCategoryName ?? r.oneCategoryName ?? r.categoryName ?? ''),
      sellPrice: Number(r.sellPrice ?? 0),
      productWeight: Number(r.productWeight ?? 0),
      productUnit: String(r.productUnit ?? ''),
      productSku: String(r.sku ?? r.productSku ?? ''),
      variants: [],
    })) as CJProduct[];
  }

  async getProductById(pid: string): Promise<CJProductDetail> {
    return this.get<CJProductDetail>(`/product/query?pid=${pid}`);
  }

  async getProductBySku(sku: string): Promise<CJProductDetail> {
    return this.get<CJProductDetail>(`/product/query?productSku=${sku}`);
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  async createOrder(input: CJOrderInput): Promise<CJOrderResult> {
    // Apply defaults only when caller passed undefined (spread would otherwise clobber them).
    const body: Record<string, unknown> = { ...input };
    if (!body.fromCountryCode) body.fromCountryCode = 'CN';
    if (!body.logisticName) body.logisticName = 'CJPacket';  // CN→EU airmail, 10-15 days
    // CJ V2 requires both shippingCountryCode (ISO2) AND shippingCountry (full name)
    if (!body.shippingCountry && body.shippingCountryCode) {
      body.shippingCountry = COUNTRY_NAME[String(body.shippingCountryCode).toUpperCase()] ?? String(body.shippingCountryCode);
    }
    log.info('Creating CJ order', {
      orderNumber: body.orderNumber,
      products: input.products.length,
      from: body.fromCountryCode,
      to: body.shippingCountryCode,
      logistic: body.logisticName,
    });
    const result = await this.post<CJOrderResult>('/shopping/order/createOrderV2', body);
    log.info('CJ order created', { orderId: result.orderId, cjOrderId: result.cjOrderId });
    return result;
  }

  async getOrderById(orderId: string): Promise<{
    orderId: string;
    orderNum: string;
    orderStatus: string;
    trackNumber: string;
    logisticName: string;
  }> {
    return this.get(`/shopping/order/getOrderDetail?orderId=${orderId}`);
  }

  async listOrders(opts?: {
    pageNum?: number;
    pageSize?: number;
    orderStatus?: string;
  }): Promise<Array<{ orderId: string; orderNum: string; orderStatus: string }>> {
    const params = new URLSearchParams({
      pageNum: String(opts?.pageNum ?? 1),
      pageSize: String(opts?.pageSize ?? 50),
    });
    if (opts?.orderStatus) params.set('orderStatus', opts.orderStatus);
    const data = await this.get<{ list: any[]; total: number }>(`/shopping/order/list?${params}`);
    return data.list ?? [];
  }

  // ── Tracking ──────────────────────────────────────────────────────────────

  async getTracking(orderId: string): Promise<CJTrackingInfo | null> {
    try {
      return await this.get<CJTrackingInfo>(`/logistic/getTrackInfo?orderId=${orderId}`);
    } catch {
      return null;
    }
  }

  // ── Logistics ─────────────────────────────────────────────────────────────

  async queryLogistics(opts: {
    startCountryCode: string;
    endCountryCode: string;
    productWeight: number;
  }): Promise<CJLogisticOption[]> {
    const params = new URLSearchParams({
      startCountryCode: opts.startCountryCode,
      endCountryCode: opts.endCountryCode,
      productWeight: String(opts.productWeight),
    });
    const data = await this.get<CJLogisticOption[]>(`/logistic/freightCalculate?${params}`);
    return data ?? [];
  }

  // ── Warehouse / Inventory ─────────────────────────────────────────────────

  async getInventory(pid: string): Promise<Array<{
    warehouseCode: string;
    warehouseName: string;
    quantity: number;
    countryCode: string;
  }>> {
    const data = await this.get<any[]>(`/product/stock/queryByPid?pid=${pid}`);
    return data ?? [];
  }

  // ── Internal HTTP helpers ─────────────────────────────────────────────────

  private async get<T>(endpoint: string): Promise<T> {
    const token = await this.ensureToken();
    return this.rawRequest<T>('GET', endpoint, undefined, {
      'CJ-Access-Token': token,
    });
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    const token = await this.ensureToken();
    return this.rawRequest<T>('POST', endpoint, body, {
      'CJ-Access-Token': token,
    });
  }

  private async rawRequest<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    // CJ enforces 1 QPS per credential — concurrent callers (discovery
    // running 6 queries at once + an inventory poll + an order placement
    // in the same second) immediately hit 429. We serialize ALL outbound
    // requests through this chain and stamp each with a >= 1100ms gap
    // (extra 100ms for clock-skew safety). Adds latency to large bursts
    // but prevents the cascade of 429s that otherwise kills a discovery
    // cycle silently.
    await CJClient.qpsGate;
    let releaseGate!: () => void;
    CJClient.qpsGate = new Promise<void>((r) => { releaseGate = r; });
    const sinceLast = Date.now() - CJClient.lastCallAt;
    if (sinceLast < 1100) {
      await new Promise((r) => setTimeout(r, 1100 - sinceLast));
    }
    CJClient.lastCallAt = Date.now();
    try {
      const url = `${CJ_BASE}${endpoint}`;
      const fetchOpts: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        signal: AbortSignal.timeout(30_000),
      };
      if (body && method !== 'GET') {
        fetchOpts.body = JSON.stringify(body);
      }

      bumpCjApiCall(1);

      const res = await fetch(url, fetchOpts);
      const json = (await res.json()) as CJApiResponse<T>;

      // On 429 (CJ-code 1600200), wait 2s and retry ONCE — covers the case
      // where multiple processes share the credential and racing past the
      // gate is unavoidable.
      if (json.code === 1600200) {
        log.warn('CJ 429 — backing off 2s then retrying', { endpoint });
        await new Promise((r) => setTimeout(r, 2_000));
        const res2 = await fetch(url, fetchOpts);
        const json2 = (await res2.json()) as CJApiResponse<T>;
        if (!res2.ok || json2.code !== 200) {
          const errMsg = `CJ API error: ${json2.message} (code: ${json2.code}, requestId: ${json2.requestId})`;
          log.error(errMsg, { endpoint, status: res2.status });
          throw new Error(errMsg);
        }
        return json2.data;
      }

      if (!res.ok || json.code !== 200) {
        const errMsg = `CJ API error: ${json.message} (code: ${json.code}, requestId: ${json.requestId})`;
        log.error(errMsg, { endpoint, status: res.status });
        throw new Error(errMsg);
      }

      return json.data;
    } finally {
      releaseGate();
    }
  }

  // Cross-instance QPS gate: every rawRequest awaits the previous one's
  // promise + the 1100ms minimum gap before sending its own request.
  private static qpsGate: Promise<void> = Promise.resolve();
  private static lastCallAt = 0;
}
