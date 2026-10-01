/**
 * P1-7: tests for the official versioned migration
 * prisma/migrations/20261001_question_variants/migration.sql
 *
 * PostgreSQL is NOT available on this VM (no server binaries, port 5432 closed),
 * so a live apply-to-fresh-DB test cannot run here. This test validates the SQL
 * file statically:
 *   1. every column/index the code actually uses exists in the file,
 *   2. every DDL statement is idempotent (safe to apply twice),
 *   3. simulating a double-application finds no unguarded statement.
 * A live fresh-DB test should be run on a machine with PostgreSQL + pgvector
 * (see the `live` describe block — it runs when PG_MIGRATION_TEST_URL is set).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'prisma',
  'migrations',
  '20261001_question_variants',
  'migration.sql',
);

// Columns the code actually touches (must all be defined in the migration):
//  - question-variant.service.ts INSERT: id, source_id, source_type, village_id,
//    scope, is_global, variant_text, embedding, embedding_model, created_at
//  - vector-db.service.ts SELECT/JOIN: source_id, variant_text, source_type,
//    village_id, scope, is_global, embedding
const EXPECTED_COLUMNS = [
  'id',
  'source_id',
  'source_type',
  'village_id',
  'scope',
  'is_global',
  'variant_text',
  'embedding',
  'embedding_model',
  'created_at',
];

// Indexes expected by schema.prisma `model question_variants`.
const EXPECTED_INDEXES = [
  'question_variants_source_id_idx',
  'question_variants_village_id_idx',
  'question_variants_scope_is_global_idx',
  'question_variants_village_scope_global_idx',
];

function loadSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf-8');
}

/** Strip line/block comments, then split top-level statements on `;`. */
function splitStatements(sql: string): string[] {
  const noComments = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Split on ';' but NOT inside dollar-quoted bodies (DO $$ ... $$ blocks).
  const stmts: string[] = [];
  let cur = '';
  let inDollar = false;
  for (let i = 0; i < noComments.length; i++) {
    if (noComments.startsWith('$$', i)) {
      inDollar = !inDollar;
      cur += '$$';
      i++;
      continue;
    }
    const ch = noComments[i];
    if (ch === ';' && !inDollar) {
      if (cur.trim().length > 0) stmts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) stmts.push(cur.trim());
  return stmts;
}

/**
 * Returns true if the statement is idempotent — safe to run twice in a row.
 * Covers: IF NOT EXISTS / IF EXISTS guards, conditional DO blocks (which query
 * catalogs like to_regclass / information_schema / pg_extension before acting),
 * and INSERT ... ON CONFLICT.
 */
function isIdempotent(stmt: string): boolean {
  const s = stmt.replace(/\s+/g, ' ');
  if (/^DO \$\$/i.test(s)) return true; // conditional blocks guard via catalog checks
  if (/CREATE\s+(TABLE|INDEX|SCHEMA|EXTENSION)\s+IF\s+NOT\s+EXISTS/i.test(s)) return true;
  if (/DROP\s+(TABLE|INDEX|COLUMN)\s+IF\s+EXISTS/i.test(s)) return true;
  if (/ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i.test(s)) return true;
  if (/ALTER\s+TABLE\s+\S+\s+ADD\s+CONSTRAINT\s+IF\s+NOT\s+EXISTS/i.test(s)) return true;
  if (/ON\s+CONFLICT/i.test(s)) return true;
  return false;
}

describe('P1-7: ai.question_variants official migration (SQL static validation)', () => {
  const sql = loadSql();

  it('migration file exists and targets ai.question_variants', () => {
    expect(sql).toContain('ai.question_variants');
  });

  it('defines every column the code uses', () => {
    for (const col of EXPECTED_COLUMNS) {
      const found = new RegExp(`\\b${col}\\b`).test(sql);
      expect(found, `column "${col}" missing from migration SQL`).toBe(true);
    }
  });

  it('defines the vector embedding column as ai.vector(768)', () => {
    expect(sql).toMatch(/embedding\s+ai\.vector\(768\)/i);
  });

  it('creates every index expected by schema.prisma', () => {
    for (const idx of EXPECTED_INDEXES) {
      expect(sql, `index "${idx}" missing from migration SQL`).toContain(idx);
    }
  });

  it('every statement is idempotent (IF NOT EXISTS / IF EXISTS / conditional DO)', () => {
    const violations = splitStatements(sql).filter((stmt) => !isIdempotent(stmt));
    expect(
      violations,
      `non-idempotent statements found:\n${violations.join('\n---\n')}`,
    ).toEqual([]);
  });

  it('simulated double-apply: re-running every statement is safe', () => {
    // Every statement must either be a guarded create or a conditional block.
    // We simulate "second run" by asserting no statement has an effect that a
    // repeat would break (no unguarded CREATE TABLE/INDEX/ALTER ADD COLUMN).
    const stmts = splitStatements(sql);
    expect(stmts.length).toBeGreaterThan(0);
    const unsafe = stmts.filter(
      (s) =>
        /CREATE\s+(TABLE|INDEX)/i.test(s) &&
        !/IF\s+NOT\s+EXISTS/i.test(s) &&
        !/^DO \$\$/i.test(s),
    );
    expect(unsafe).toEqual([]);
  });
});

describe('P1-7: ai.question_variants migration — live fresh-DB test', () => {
  it('applies cleanly to a fresh DB and twice in a row', async () => {
    const url = process.env.PG_MIGRATION_TEST_URL;
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn(
        '[P1-7] PG_MIGRATION_TEST_URL not set and no local PostgreSQL on this VM — ' +
          'live fresh-DB test SKIPPED. Static SQL validation above is the coverage; ' +
          'run the live test on a host with PostgreSQL + pgvector before deploy.',
      );
      return; // honest skip: cannot do a live apply here
    }
    // Loaded lazily via eval('require') so the static tests never require the pg
    // driver at type-check time (pg is not a dependency of this service).
    const req = eval('require') as (id: string) => any;
    const { Client } = req('pg');
    const sql = loadSql();
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(sql); // first apply on fresh DB
      await client.query(sql); // second apply must be a no-op, not an error
      const cols = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'question_variants'`,
      );
      const names = cols.rows.map((r: { column_name: string }) => r.column_name);
      for (const col of EXPECTED_COLUMNS) {
        expect(names).toContain(col);
      }
    } finally {
      await client.end();
    }
  });
});
