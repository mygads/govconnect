import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { PrismaClient } from '@prisma/client';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseIntArg(name: string, fallback: number): number {
  const raw = getArg(name);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeText(input: string): string {
  return (input || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\t ]{2,}/g, ' ')
    .trim();
}

function splitIntoChunks(text: string, maxLen = 8000): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];

  const paragraphs = clean.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const v = current.trim();
    if (v) chunks.push(v);
    current = '';
  };

  for (const p of paragraphs) {
    if (p.length > maxLen) {
      // Fallback: hard split a very long paragraph.
      flush();
      for (let i = 0; i < p.length; i += maxLen) {
        chunks.push(p.slice(i, i + maxLen));
      }
      continue;
    }

    if (!current) {
      current = p;
      continue;
    }

    if ((current.length + 2 + p.length) <= maxLen) {
      current += `\n\n${p}`;
    } else {
      flush();
      current = p;
    }
  }

  flush();
  return chunks;
}

const STOPWORDS = new Set([
  'yang','dan','atau','dari','ke','di','pada','untuk','dengan','ini','itu','sebagai','juga','agar','bisa','dapat','tidak','iya','ya','kak','saya','anda','kami',
  'the','a','an','of','to','in','on','for','with','is','are','be','as','by','at',
]);

function extractKeywords(text: string, limit = 40): string[] {
  const normalized = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalized
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, limit);
}

async function main() {
  const filePathArg = getArg('--file') || getArg('-f');
  if (!filePathArg) {
    throw new Error('Missing --file <path-to-pdf>');
  }

  const absolutePath = path.isAbsolute(filePathArg)
    ? filePathArg
    : path.resolve(process.cwd(), filePathArg);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const category = (getArg('--category') || 'informasi_umum').trim();
  const priority = parseIntArg('--priority', 5);
  const maxLen = parseIntArg('--max-len', 8000);

  const dryRun = hasFlag('--dry-run');

  const villageIdArg = getArg('--village-id')?.trim();
  const villageSlugArg = getArg('--village-slug')?.trim();
  const categoryIdArg = getArg('--category-id')?.trim();

  const titleArg = getArg('--title')?.trim();
  const baseTitle = titleArg && titleArg.length > 0
    ? titleArg
    : path.basename(absolutePath).replace(/\.[^/.]+$/, '');

  const raw = fs.readFileSync(absolutePath);

  // Currently supports PDF only (as requested).
  const parser = new PDFParse({ data: raw });
  const parsed: any = await parser.getText();
  const extracted = normalizeText(parsed?.text || '');

  if (!extracted) {
    throw new Error('PDF parsed but produced empty text.');
  }

  const chunks = splitIntoChunks(extracted, maxLen);
  if (chunks.length === 0) {
    throw new Error('No chunks produced from extracted text.');
  }

  if (dryRun) {
    console.log('🧪 DRY RUN - No DB writes');
    console.log(`   File: ${absolutePath}`);
    console.log(`   Extracted chars: ${extracted.length}`);
    console.log(`   Chunk size (--max-len): ${maxLen}`);
    console.log(`   Chunks: ${chunks.length}`);
    console.log(`   Category: ${category}`);
    console.log(`   Priority: ${priority}`);
    console.log(`   Village (arg): ${villageIdArg || villageSlugArg || '(not provided)'}`);
    console.log(`   Category ID (arg): ${categoryIdArg || '(not provided)'}`);
    console.log(`   Title base: ${baseTitle}`);
    console.log('   First chunk preview (200 chars):');
    console.log(`   ${chunks[0].slice(0, 200).replace(/\s+/g, ' ')}`);
    return;
  }

  const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  });

  try {
    let villageId: string | null = null;

    if (villageIdArg) {
      villageId = villageIdArg;
    } else if (villageSlugArg) {
      const village = await prisma.villages.findUnique({ where: { slug: villageSlugArg } });
      if (!village) throw new Error(`Village not found for slug: ${villageSlugArg}`);
      villageId = village.id;
    } else if ((process.env.DEFAULT_VILLAGE_ID || '').trim()) {
      villageId = (process.env.DEFAULT_VILLAGE_ID || '').trim();
    }

    const resolvedCategoryId = categoryIdArg && categoryIdArg.length > 0 ? categoryIdArg : null;

    let upserted = 0;

    for (let i = 0; i < chunks.length; i++) {
      const partTitle = chunks.length > 1
        ? `${baseTitle} (Bagian ${i + 1}/${chunks.length})`
        : baseTitle;

      const content = chunks[i];
      const keywords = extractKeywords(`${partTitle} ${content}`, 40);

      const existing = await prisma.knowledge_base.findFirst({
        where: {
          title: partTitle,
          category,
          village_id: villageId,
        },
      });

      if (existing) {
        await prisma.knowledge_base.update({
          where: { id: existing.id },
          data: {
            content,
            keywords,
            is_active: true,
            priority: Number.isFinite(priority) ? priority : 5,
            ...(resolvedCategoryId ? { category_id: resolvedCategoryId } : {}),
          },
        });
      } else {
        await prisma.knowledge_base.create({
          data: {
            title: partTitle,
            content,
            category,
            village_id: villageId,
            keywords,
            is_active: true,
            priority: Number.isFinite(priority) ? priority : 5,
            category_id: resolvedCategoryId,
            admin_id: null,
          },
        });
      }

      upserted++;
    }

    console.log('✅ Knowledge imported');
    console.log(`   File: ${absolutePath}`);
    console.log(`   Village: ${villageId ?? '(global/null)'}`);
    console.log(`   Category: ${category}`);
    console.log(`   Items upserted: ${upserted}`);

    if (hasFlag('--embed')) {
      const aiBaseUrl = (process.env.AI_SERVICE_URL || 'http://localhost:3002').replace(/\/$/, '');
      const url = `${aiBaseUrl}/api/knowledge/embed-all`;

      const internalApiKey = (process.env.INTERNAL_API_KEY || '').trim();

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: internalApiKey ? { 'x-internal-api-key': internalApiKey } : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.warn('⚠️ Failed to trigger embed-all', { status: res.status, body: json });
        } else {
          console.log('✅ Triggered AI embed-all', json);
        }
      } catch (e: any) {
        console.warn('⚠️ Could not call AI embed-all (is ai-service running?)', { error: e?.message || e });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Import failed:', e?.message || e);
  process.exit(1);
});
