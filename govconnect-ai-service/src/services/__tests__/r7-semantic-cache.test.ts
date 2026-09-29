/**
 * R7 — Semantic cache invalidation wiring.
 *
 * semanticCacheInvalidate() harus dipanggil saat KB berubah:
 * 1. document-ingest.service.ts (sudah ada)
 * 2. knowledge.routes.ts POST / (tambah)
 * 3. knowledge.routes.ts PUT /:id (tambah)
 * 4. knowledge.routes.ts DELETE /:id (tambah)
 * 5. kb-publish.service.ts (tambah)
 *
 * Test ini verifikasi wiring via static analysis (grep source),
 * karena invalidation adalah fire-and-forget void promise.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf-8');
}

describe('R7: semanticCacheInvalidate wiring', () => {
  it('document-ingest.service.ts memanggil semanticCacheInvalidate', () => {
    const src = readSrc('services/document-ingest.service.ts');
    expect(src).toContain('semanticCacheInvalidate');
  });

  it('knowledge.routes.ts mengimpor semanticCacheInvalidate', () => {
    const src = readSrc('routes/knowledge.routes.ts');
    expect(src).toContain("import { semanticCacheInvalidate } from '../pipeline/pipeline-store'");
  });

  it('knowledge.routes.ts memanggil semanticCacheInvalidate minimal 3× (POST, PUT, DELETE)', () => {
    const src = readSrc('routes/knowledge.routes.ts');
    const matches = src.match(/semanticCacheInvalidate\(/g) || [];
    // 3 calls: POST, PUT, DELETE (import tidak dihitung karena tanpa paren)
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('kb-publish.service.ts memanggil semanticCacheInvalidate setelah publish', () => {
    const src = readSrc('services/kb-publish.service.ts');
    expect(src).toContain('semanticCacheInvalidate');
    // Harus setelah status di-update ke published
    const publishIdx = src.indexOf("'published'");
    const invalidateIdx = src.indexOf('semanticCacheInvalidate(');
    expect(invalidateIdx).toBeGreaterThan(publishIdx);
  });

  it('pipeline-store.ts mengekspor semanticCacheInvalidate', () => {
    const src = readSrc('pipeline/pipeline-store.ts');
    expect(src).toContain('export async function semanticCacheInvalidate');
  });
});
