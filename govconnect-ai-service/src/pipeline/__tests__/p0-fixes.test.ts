/**
 * P0-1, P0-3, P0-4 regression tests (2026-10-02).
 * - P0-1: explicit handoff requests must be detected from any stage
 * - P0-3: identity questions must match broader patterns
 * - P0-4: deterministic name extraction fallback
 */
import { describe, it, expect } from 'vitest';
import {
  assessStage,
  isExplicitHandoffRequest,
} from '../stage-assessor';
import { extractNameDeterministic } from '../../services/complaint-fsm.service';

describe('P0-1: explicit handoff detection', () => {
  it('detects "saya mau ngomong sama orang aja" (T-62)', () => {
    expect(isExplicitHandoffRequest('nggak jelas, saya mau ngomong sama orang aja')).toBe(true);
  });

  it('detects "panggilkan petugas aja" (T-63)', () => {
    expect(isExplicitHandoffRequest('ah ribet, panggilkan petugas aja')).toBe(true);
  });

  it('detects "saya mau bicara sama petugasnya langsung" (T-61)', () => {
    expect(isExplicitHandoffRequest('saya mau bicara sama petugasnya langsung')).toBe(true);
  });

  it('does not trigger on normal messages', () => {
    expect(isExplicitHandoffRequest('syarat ktp apa?')).toBe(false);
    expect(isExplicitHandoffRequest('jalan rt 03 rusak parah')).toBe(false);
    expect(isExplicitHandoffRequest('halo')).toBe(false);
  });

  it('assessStage returns HANDOFF from COLLECT on explicit request', async () => {
    const decision = await assessStage({
      message: 'panggilkan petugas aja',
      fromStage: 'COLLECT',
    });
    expect(decision.stage).toBe('HANDOFF');
    expect(decision.source).toBe('deterministic');
  });

  it('assessStage returns HANDOFF from INFORMATION on explicit request', async () => {
    const decision = await assessStage({
      message: 'saya mau ngomong sama orang aja',
      fromStage: 'INFORMATION',
    });
    expect(decision.stage).toBe('HANDOFF');
    expect(decision.source).toBe('deterministic');
  });
});

describe('P0-4: deterministic name extraction', () => {
  it('extracts "Budi Santoso" (T-50)', () => {
    expect(extractNameDeterministic('Budi Santoso')).toBe('Budi Santoso');
  });

  it('extracts from "nama saya Budi Santoso"', () => {
    expect(extractNameDeterministic('nama saya Budi Santoso')).toBe('Budi Santoso');
  });

  it('extracts from "saya bernama Dewi"', () => {
    expect(extractNameDeterministic('saya bernama Dewi')).toBe('Dewi');
  });

  it('extracts from "panggil saya Pakde"', () => {
    expect(extractNameDeterministic('panggil saya Pakde')).toBe('Pakde');
  });

  it('rejects non-names', () => {
    expect(extractNameDeterministic('halo')).toBeNull();
    expect(extractNameDeterministic('jalan rusak')).toBeNull();
    expect(extractNameDeterministic('saya warga desa')).toBeNull();
    expect(extractNameDeterministic('12345')).toBeNull();
  });

  it('rejects locations', () => {
    expect(extractNameDeterministic('Jl Merdeka No 10')).toBeNull();
    expect(extractNameDeterministic('rt 05 rw 02')).toBeNull();
  });
});
