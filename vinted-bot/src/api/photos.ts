// ──────────────────────────────────────────────────────────────────────────────
// Vinted Photo Upload via API.
//
// Vinted nutzt ein 2-Schritt-Pattern:
//   1. POST /api/v2/photos (multipart/form-data) → temp_uuid + ID
//   2. Beim POST /api/v2/items werden die UUIDs/IDs als `assigned_photos` mitgesendet
//
// Wir laden Datei vom Disk, packen in FormData, senden multipart.
// Bei Fail: Diagnose-Dump.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@vinted-system/shared';
import type { VintedApi } from './client.js';

const log = createLogger('vinted-api-photos');

export interface UploadedPhoto {
  id?: number;
  temp_uuid?: string;
  url?: string;
  full_size_url?: string;
  width?: number;
  height?: number;
}

interface PhotoUploadResponse {
  photo?: UploadedPhoto;
  data?: UploadedPhoto;
  uploaded_photo?: UploadedPhoto;
  id?: number;
  temp_uuid?: string;
}

function mediaTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * Lädt eine einzelne Datei hoch.
 * Falls der Endpoint variiert, probieren wir 2 bekannte Pfade:
 *   /api/v2/photos
 *   /api/v2/photos/upload
 */
export async function uploadPhoto(api: VintedApi, filePath: string): Promise<UploadedPhoto> {
  const buf = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const mediaType = mediaTypeFor(filePath);

  const ENDPOINTS = ['/api/v2/photos', '/api/v2/photos/upload'];
  let lastErr: unknown;

  for (const ep of ENDPOINTS) {
    try {
      const fd = new FormData();
      // Manche Vinted-Versionen nutzen `photo`, andere `image`
      // Buffer → ArrayBuffer slice für Blob-Kompatibilität
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      fd.append('photo', new Blob([ab], { type: mediaType }), fileName);
      fd.append('type', 'item');

      const result = await api.call<PhotoUploadResponse>(ep, {
        method: 'POST',
        rawBody: fd,
        timeoutMs: 60_000,
        retryAttempts: 2,
      });
      const photo = result.photo ?? result.data ?? result.uploaded_photo ?? {
        id: result.id,
        temp_uuid: result.temp_uuid,
      };
      if (!photo.id && !photo.temp_uuid) {
        log.warn('upload response missing photo id/uuid', { ep, result });
        continue;
      }
      log.info('photo uploaded', { ep, fileName, id: photo.id, temp_uuid: photo.temp_uuid });
      return photo;
    } catch (err) {
      lastErr = err;
      log.warn('photo upload endpoint failed', { ep, err: String(err) });
    }
  }
  throw lastErr ?? new Error('photo upload failed: all endpoints exhausted');
}

export async function uploadPhotos(api: VintedApi, filePaths: string[]): Promise<UploadedPhoto[]> {
  const out: UploadedPhoto[] = [];
  // Sequenziell — Vinted's Upload-Endpoint mag keine 5+ parallele Multipart-POSTs
  for (const fp of filePaths) {
    try {
      const photo = await uploadPhoto(api, fp);
      out.push(photo);
      // Politeness 600-1200ms
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
    } catch (err) {
      log.error('skip photo (upload failed)', { fp, err: String(err) });
    }
  }
  if (out.length === 0) throw new Error('no photos uploaded successfully');
  return out;
}
