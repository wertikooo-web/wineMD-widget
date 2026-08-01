import crypto from 'node:crypto';
import { getPool, postgresEnabled } from '../db/Postgres.js';

const normalize = value => String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const id = value => `cat-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20)}`;

function asProducts(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
  if (payload && typeof payload === 'object' && (payload.id || payload.external_id || payload.externalId || payload.sku)) return [payload];
  return [];
}

function productFields(raw) {
  const externalId = String(raw.external_id ?? raw.externalId ?? raw.id ?? raw.sku ?? '').trim();
  const title = String(raw.title ?? raw.name ?? raw.product_name ?? '').trim();
  if (!externalId || !title) return null;
  return {
    externalId,
    title,
    vintage: raw.vintage == null ? null : String(raw.vintage),
    volumeMl: Number.isFinite(Number(raw.volume_ml ?? raw.volumeMl ?? raw.volume)) ? Number(raw.volume_ml ?? raw.volumeMl ?? raw.volume) : null,
    price: Number.isFinite(Number(raw.price)) ? Number(raw.price) : null,
    currency: String(raw.currency ?? 'MDL').trim() || 'MDL',
    availability: String(raw.availability ?? raw.stock_status ?? (raw.in_stock === true ? 'in_stock' : raw.in_stock === false ? 'out_of_stock' : 'unknown')),
    stockQuantity: Number.isFinite(Number(raw.stock_quantity ?? raw.stockQuantity ?? raw.quantity)) ? Number(raw.stock_quantity ?? raw.stockQuantity ?? raw.quantity) : null,
    productUrl: raw.product_url ?? raw.productUrl ?? raw.url ?? null,
    imageUrl: raw.image_url ?? raw.imageUrl ?? raw.image ?? null,
    raw
  };
}

export class WineMdCatalogSyncService {
  constructor({ db, sourceUrl = process.env.WINEMD_CATALOG_URL, webhookSecret = process.env.WINEMD_WEBHOOK_SECRET, fetchImpl = globalThis.fetch } = {}) {
    this.db = db ?? null;
    this.sourceUrl = sourceUrl;
    this.webhookSecret = webhookSecret;
    this.fetchImpl = fetchImpl;
    this.timer = null;
  }

  pool() {
    if (this.db) return this.db;
    if (!postgresEnabled()) {
      const error = new Error('Catalog sync requires PostgreSQL');
      error.code = 'POSTGRES_REQUIRED';
      throw error;
    }
    return getPool();
  }

  verifyWebhook(req) {
    if (!this.webhookSecret) return false;
    const supplied = String(req.headers['x-winemd-secret'] ?? req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '');
    const a = Buffer.from(supplied);
    const b = Buffer.from(String(this.webhookSecret));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async status() {
    const db = this.pool();
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM catalog_products) AS products,
        (SELECT COUNT(*)::int FROM catalog_products WHERE availability IN ('in_stock','available')) AS available,
        (SELECT COUNT(*)::int FROM catalog_products WHERE wine_entity_id IS NULL) AS unmatched,
        (SELECT last_synced_at FROM catalog_products ORDER BY last_synced_at DESC LIMIT 1) AS last_synced_at,
        (SELECT jsonb_build_object('id',id,'status',status,'mode',mode,'productsSeen',products_seen,'productsChanged',products_changed,'productsFailed',products_failed,'startedAt',started_at,'finishedAt',finished_at)
          FROM catalog_sync_jobs ORDER BY created_at DESC LIMIT 1) AS last_job
    `);
    return result.rows[0];
  }

  async fetchRemote() {
    if (!this.sourceUrl) {
      const error = new Error('WINEMD_CATALOG_URL is not configured');
      error.code = 'CATALOG_URL_NOT_CONFIGURED';
      throw error;
    }
    const response = await this.fetchImpl(this.sourceUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const error = new Error(`Wine.md catalog returned HTTP ${response.status}`);
      error.code = 'CATALOG_FETCH_FAILED';
      throw error;
    }
    return response.json();
  }

  async syncRemote({ mode = 'scheduled' } = {}) {
    return this.syncPayload(await this.fetchRemote(), { mode });
  }

  async syncPayload(payload, { mode = 'webhook' } = {}) {
    const db = this.pool();
    const products = asProducts(payload);
    const jobId = `catalog-job-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO catalog_sync_jobs(id,mode,status,started_at) VALUES($1,$2,'running',now())`, [jobId, mode]);
    let changed = 0;
    let failed = 0;

    for (const raw of products) {
      const product = productFields(raw);
      if (!product) {
        failed += 1;
        await db.query(`INSERT INTO catalog_sync_errors(job_id,error,payload) VALUES($1,'Missing product id or title',$2::jsonb)`, [jobId, JSON.stringify(raw)]);
        continue;
      }
      try {
        const entity = await db.query(`
          SELECT id FROM entities
          WHERE entity_type IN ('wine','product')
            AND (normalized_name=$1 OR normalized_name LIKE $2 OR $1 LIKE '%' || normalized_name || '%')
          ORDER BY CASE WHEN normalized_name=$1 THEN 0 ELSE 1 END, length(normalized_name) DESC
          LIMIT 1
        `, [normalize(product.title), `%${normalize(product.title)}%`]);
        const result = await db.query(`
          INSERT INTO catalog_products(id,external_id,wine_entity_id,title,vintage,volume_ml,price,currency,availability,stock_quantity,product_url,image_url,raw_payload,last_synced_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now(),now())
          ON CONFLICT(external_id) DO UPDATE SET
            wine_entity_id=COALESCE(EXCLUDED.wine_entity_id,catalog_products.wine_entity_id),title=EXCLUDED.title,vintage=EXCLUDED.vintage,
            volume_ml=EXCLUDED.volume_ml,price=EXCLUDED.price,currency=EXCLUDED.currency,availability=EXCLUDED.availability,
            stock_quantity=EXCLUDED.stock_quantity,product_url=EXCLUDED.product_url,image_url=EXCLUDED.image_url,
            raw_payload=EXCLUDED.raw_payload,last_synced_at=now(),updated_at=now()
          RETURNING (xmax = 0) AS inserted
        `, [id(product.externalId),product.externalId,entity.rows[0]?.id ?? null,product.title,product.vintage,product.volumeMl,product.price,product.currency,product.availability,product.stockQuantity,product.productUrl,product.imageUrl,JSON.stringify(product.raw)]);
        if (result.rowCount) changed += 1;
      } catch (error) {
        failed += 1;
        await db.query(`INSERT INTO catalog_sync_errors(job_id,external_id,error,payload) VALUES($1,$2,$3,$4::jsonb)`, [jobId, product.externalId, error.message, JSON.stringify(raw)]);
      }
    }

    await db.query(`UPDATE catalog_sync_jobs SET status=$2,products_seen=$3,products_changed=$4,products_failed=$5,finished_at=now() WHERE id=$1`, [jobId, failed ? 'completed_with_errors' : 'completed', products.length, changed, failed]);
    return { jobId, productsSeen: products.length, productsChanged: changed, productsFailed: failed };
  }

  startScheduler(intervalMinutes = Number(process.env.WINEMD_SYNC_INTERVAL_MINUTES ?? 30)) {
    if (!this.sourceUrl || this.timer) return false;
    const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;
    this.timer = setInterval(() => this.syncRemote({ mode: 'scheduled' }).catch(error => console.error('[winemd-catalog-sync]', error.message)), intervalMs);
    this.timer.unref?.();
    return true;
  }

  stopScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
