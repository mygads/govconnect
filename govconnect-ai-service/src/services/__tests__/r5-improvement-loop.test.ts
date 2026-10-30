/**
 * R5 — Improvement loop: publish endpoint, scheduler, debugger skill.
 *
 * 1. Publish: hanya proposal 'approved' yang bisa di-publish.
 * 2. Scheduler: idempotent, no-op saat disabled.
 * 3. Debugger skill: file SKILL.md ada dan valid.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Scheduler unit tests ──────────────────────────────────────────────────
import {
  startKbSuggesterScheduler,
  __resetKbSuggesterSchedulerForTest,
  __isKbSuggesterSchedulerStarted,
} from '../kb-suggester-scheduler';

describe('R5: KB suggester scheduler', () => {
  beforeEach(() => {
    __resetKbSuggesterSchedulerForTest();
    delete process.env.KB_SUGGESTER_ENABLED;
  });

  it('no-op saat KB_SUGGESTER_ENABLED=false (default)', () => {
    process.env.KB_SUGGESTER_ENABLED = 'false';
    startKbSuggesterScheduler();
    expect(__isKbSuggesterSchedulerStarted()).toBe(false);
  });

  it('idempotent: start 2× tidak double-register', () => {
    process.env.KB_SUGGESTER_ENABLED = 'true';
    process.env.KB_SUGGESTER_INTERVAL_MS = '3600000';
    startKbSuggesterScheduler();
    expect(__isKbSuggesterSchedulerStarted()).toBe(true);
    // Second call should be no-op (flag already set).
    startKbSuggesterScheduler();
    expect(__isKbSuggesterSchedulerStarted()).toBe(true);
  });
});

// ── Publish validation logic ──────────────────────────────────────────────
// Pure logic: status transition rules for publish.

describe('R5: publish status rules', () => {
  it('hanya approved yang bisa di-publish', async () => {
    const { canTransition } = await import('../kb-suggester.service');
    // approved → published: valid
    expect(canTransition('approved', 'published')).toBe(true);
    // pending → published: invalid (harus via approved dulu)
    expect(canTransition('pending', 'published')).toBe(false);
    // rejected → published: invalid
    expect(canTransition('rejected', 'published')).toBe(false);
    // published → published: invalid (sudah published)
    expect(canTransition('published', 'published')).toBe(false);
  });
});

// ── Debugger skill file ───────────────────────────────────────────────────

describe('R5: debugger skill SKILL.md', () => {
  const skillPath = path.join(__dirname, '..', '..', 'skills', 'debugger', 'SKILL.md');

  it('file SKILL.md ada', () => {
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it('punya frontmatter name dan description', () => {
    const content = fs.readFileSync(skillPath, 'utf-8');
    expect(content).toContain('name: govconnect-debugger');
    expect(content).toContain('description:');
  });

  it('mencakup 5 area diagnosis utama', () => {
    const content = fs.readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Tiket tidak terbuat');
    expect(content).toContain('Jawaban AI kosong');
    expect(content).toContain('KB tidak ketemu');
    expect(content).toContain('Billing aneh');
    expect(content).toContain('Webhook tidak masuk');
  });

  it('mencakup perintah cepat operasional', () => {
    const content = fs.readFileSync(skillPath, 'utf-8');
    expect(content).toContain('curl');
    expect(content).toContain('PIPELINE_MODE');
  });
});
