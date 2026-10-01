/**
 * P1-10: location parsing + slot state.
 *
 * Covers the natural-language examples from the task plus the multi-turn
 * slot-state guarantees:
 * - location components extracted (jalan/dusun/rt-rw/patokan/koordinat)
 * - a filled slot is never clobbered by an unrelated answer next turn
 * - a user correction overwrites the RIGHT slot in the same turn
 * - required vs optional slots are explicit
 */
import { describe, it, expect } from 'vitest';
import {
  parseLocation,
  isAnaphoricLocation,
  extractSlotsDeterministic,
  mergeSlots,
  nextMissingSlot,
  getRequiredSlotNames,
  renderVerifySummary,
  buildPendingMutation,
  type Slots,
} from '../slot-fsm';

describe('P1-10 parseLocation — component extraction', () => {
  it('parses "di jalan merdeka no 10" as a street', () => {
    const p = parseLocation('di jalan merdeka no 10');
    expect(p?.street).toBe('jalan merdeka no 10');
    expect(p?.raw).toBe('jalan merdeka no 10');
  });

  it('keeps the house number when written "no. 10" (no truncation at the dot)', () => {
    const p = parseLocation('di jalan merdeka no. 10');
    expect(p?.raw).toBe('jalan merdeka no. 10');
  });

  it('parses "depan balai desa" as a landmark/patokan', () => {
    const p = parseLocation('depan balai desa');
    expect(p?.landmark).toBe('depan balai desa');
  });

  it('parses "dusun krajan rt 02" as hamlet + lone RT', () => {
    const p = parseLocation('dusun krajan rt 02');
    expect(p?.hamlet).toBe('krajan');
    expect(p?.rt).toBe('02');
    expect(p?.raw).toMatch(/dusun krajan/i);
    expect(p?.raw).toMatch(/RT 02/);
  });

  it('parses "koordinat -7.781, 110.360" as coordinates', () => {
    const p = parseLocation('koordinat -7.781, 110.360');
    expect(p?.coordinates).toBe('-7.781, 110.360');
    expect(p?.raw).toBe('-7.781, 110.360');
  });

  it('normalizes Indonesian decimal commas in coordinates', () => {
    const p = parseLocation('koordinat -7,781; 110,360');
    expect(p?.coordinates).toBe('-7.781, 110.360');
  });

  it('rejects out-of-Indonesia coordinate pairs', () => {
    expect(parseLocation('koordinat 40.71, -74.00')).toBeNull();
  });

  it('returns null for anaphoric "di sana" / "di situ" — never stored as location', () => {
    expect(parseLocation('di sana')).toBeNull();
    expect(parseLocation('di situ')).toBeNull();
    expect(isAnaphoricLocation('di sana')).toBe(true);
    expect(isAnaphoricLocation('di situ')).toBe(true);
    expect(isAnaphoricLocation('di jalan merdeka no 10')).toBe(false);
  });

  it('does not swallow description text into the location ("jalan berlubang di depan balai desa")', () => {
    const p = parseLocation('jalan berlubang di depan balai desa');
    expect(p?.landmark).toBe('depan balai desa');
    expect(p?.street).toBeUndefined();
    expect(p?.raw).toBe('(depan balai desa)');
  });

  it('composes street + RT/RW + landmark from one message', () => {
    const p = parseLocation('di Jl. Mawar RT 03 RW 05, depan warung Bu Ani');
    expect(p?.street).toMatch(/mawar/i);
    expect(p?.rt).toBe('03');
    expect(p?.rw).toBe('05');
    expect(p?.landmark).toBe('depan warung Bu Ani');
    expect(p?.raw).toMatch(/mawar/i);
    expect(p?.raw).toMatch(/RT 03 RW 05/);
  });

  it('extracts RT/RW pair without storing damage words as street', () => {
    const p = parseLocation('Jalan rusak parah di RT 02/RW 05');
    expect(p?.rt).toBe('02');
    expect(p?.rw).toBe('05');
    expect(p?.street).toBeUndefined();
  });
});

describe('P1-10 slot state across turns', () => {
  function turn(existing: Slots, message: string, expectedSlot: string | null): Slots {
    const extracted = extractSlotsDeterministic(message, 'complaint', expectedSlot, existing);
    return mergeSlots('complaint', existing, extracted).slots;
  }

  it('multi-turn: description answer does not clobber the filled location', () => {
    let s: Slots = {};
    s = turn(s, 'jalan rusak parah', 'category');
    expect(s.category).toBe('jalan rusak');
    // "jalan rusak parah" is damage description, not a street — location stays empty.
    expect(s.location).toBeUndefined();

    s = turn(s, 'di jalan merdeka no 10', 'location');
    expect(s.location).toBe('jalan merdeka no 10');

    // The old bug: this description (containing "jalan") overwrote location.
    s = turn(s, 'jalan berlubang besar di tengah jalan sudah 2 minggu', 'description');
    expect(s.location).toBe('jalan merdeka no 10');
    expect(s.description).toMatch(/sudah 2 minggu/);
  });

  it('correction overwrites the RIGHT slot: "salah, lokasinya di jalan sudirman"', () => {
    const existing: Slots = {
      category: 'jalan rusak',
      location: 'jalan merdeka no 10',
      description: 'jalan berlubang besar sudah 2 minggu',
    };
    const s = turn(existing, 'salah, lokasinya di jalan sudirman', null);
    expect(s.location).toBe('jalan sudirman');
    expect(s.category).toBe('jalan rusak');
    expect(s.description).toBe('jalan berlubang besar sudah 2 minggu');
  });

  it('explicit description correction overwrites only the description', () => {
    const existing: Slots = {
      category: 'jalan rusak',
      location: 'jalan merdeka no 10',
      description: 'jalan berlubang besar sudah 2 minggu',
    };
    const s = turn(existing, 'ubah deskripsinya: kejadiannya kemarin sore', null);
    expect(s.description).toBe('kejadiannya kemarin sore');
    expect(s.location).toBe('jalan merdeka no 10');
    expect(s.category).toBe('jalan rusak');
  });

  it('coordinates fill the location slot', () => {
    const s = turn({}, 'koordinat -7.781, 110.360', 'location');
    expect(s.location).toBe('-7.781, 110.360');
  });

  it('anaphoric "di sana" never becomes a location value', () => {
    const s = turn({}, 'di sana', 'location');
    expect(s.location).toBeUndefined();
  });

  it('mergeSlots keeps a filled slot when the incoming value is invalid', () => {
    const { slots, errors } = mergeSlots(
      'complaint',
      { description: 'deskripsi lama yang valid' },
      { description: 'ok' },
    );
    expect(slots.description).toBe('deskripsi lama yang valid');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('mergeSlots ignores empty-string incoming values', () => {
    const { slots } = mergeSlots(
      'complaint',
      { location: 'jalan merdeka no 10' },
      { location: '   ' },
    );
    expect(slots.location).toBe('jalan merdeka no 10');
  });
});

describe('P1-10 required vs optional slots', () => {
  it('only required slots gate COLLECT completion', () => {
    expect(getRequiredSlotNames('complaint')).toEqual(['category', 'description', 'location']);
    expect(getRequiredSlotNames('complaint')).not.toContain('reporter_name');
    const withoutOptional: Slots = {
      category: 'sampah', description: 'menumpuk seminggu', location: 'RT 01',
    };
    expect(nextMissingSlot('complaint', withoutOptional)).toBeNull();
  });

  it('verify summary marks optional slots explicitly', () => {
    const s = renderVerifySummary('complaint', {
      category: 'sampah', description: 'menumpuk', location: 'RT 01', reporter_name: 'Budi',
    } as Slots);
    expect(s).toContain('Nama pelapor (opsional): Budi');
    expect(s).not.toContain('Lokasi (opsional)');
  });
});

describe('P1-10 pending mutation RT/RW', () => {
  it('accepts RT/RW without slash and normalizes it', () => {
    const m = buildPendingMutation('complaint', {
      category: 'jalan rusak',
      description: 'berlubang dalam',
      location: 'Jl. Mawar, RT 03 RW 05 (depan warung Bu Ani)',
    } as Slots);
    expect(m?.args.rt_rw).toBe('RT 03/RW 05');
  });

  it('still accepts the slashed form', () => {
    const m = buildPendingMutation('complaint', {
      category: 'jalan rusak',
      description: 'berlubang dalam',
      location: 'RT 02/RW 05',
    } as Slots);
    expect(m?.args.rt_rw).toBe('RT 02/RW 05');
  });
});
