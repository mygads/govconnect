/**
 * EVAL intent classification — fresh natural variants.
 *
 * NOTE: these deliberately do NOT repeat the round-1 golden set
 * (scripts/golden-set.json: "KTP saya rusak", "KK hilang", "Jalan depan rumah
 * saya berlubang besar", …). They exercise the deterministic classifier
 * (slot-fsm.classifySlotIntent) and keyword slot extractor with:
 * dialect/colloquial phrasing, typos, vague inputs, multi-intent ambiguity,
 * and the LAP- status pattern that must NOT be misread as a complaint.
 *
 * Design rule under test: classifySlotIntent returns null on ambiguity —
 * the pipeline stays in TRIAGE and asks, never guesses.
 */
import {
  classifySlotIntent,
  extractSlotsDeterministic,
} from '../../pipeline/slot-fsm';
import { check } from '../support';
import type { EvalCase } from '../types';

export const cases: EvalCase[] = [
  {
    id: 'EVAL-I01',
    category: 'intent-classification',
    input: 'bang mau bikin kk buat anakku yang baru lahir',
    expect: 'intent = service_request',
    description: 'Colloquial/dialect service request (KK for newborn) → service_request',
    run: async () => {
      const intent = classifySlotIntent('bang mau bikin kk buat anakku yang baru lahir');
      check(intent === 'service_request', `expected service_request, got ${intent}`);
    },
  },
  {
    id: 'EVAL-I02',
    category: 'intent-classification',
    input: 'ktp ku ilang di pasar, gmna cara ngurusnya min',
    expect: 'intent = service_request',
    description: 'Typo + dialect service request (lost KTP) → service_request',
    run: async () => {
      const intent = classifySlotIntent('ktp ku ilang di pasar, gmna cara ngurusnya min');
      check(intent === 'service_request', `expected service_request, got ${intent}`);
    },
  },
  {
    id: 'EVAL-I03',
    category: 'intent-classification',
    input: 'lampu jalan depan balai desa mati udah seminggu, gelap bgt',
    expect: 'intent = complaint',
    description: 'Colloquial complaint (street light out) → complaint',
    run: async () => {
      const intent = classifySlotIntent('lampu jalan depan balai desa mati udah seminggu, gelap bgt');
      check(intent === 'complaint', `expected complaint, got ${intent}`);
    },
  },
  {
    id: 'EVAL-I04',
    category: 'intent-classification',
    input: 'drainase mampet depan rumah, tiap hujan banjir masuk teras',
    expect: 'intent = complaint, category slot = banjir',
    description: 'Drainage/flood complaint → complaint + extracted category banjir',
    run: async () => {
      const msg = 'drainase mampet depan rumah, tiap hujan banjir masuk teras';
      const intent = classifySlotIntent(msg);
      check(intent === 'complaint', `expected complaint, got ${intent}`);
      const slots = extractSlotsDeterministic(msg, 'complaint');
      check(slots.category === 'banjir', `expected category 'banjir', got '${slots.category}'`);
      check(!!slots.location, 'expected a location slot to be extracted');
    },
  },
  {
    id: 'EVAL-I05',
    category: 'intent-classification',
    input: 'min, bayar PBB bisa lewat mana ya?',
    expect: 'intent = null (stays TRIAGE, never guessed)',
    description: 'Pure information question (PBB payment) → null, not forced into complaint/service',
    run: async () => {
      const intent = classifySlotIntent('min, bayar PBB bisa lewat mana ya?');
      check(intent === null, `expected null (ambiguous/info), got ${intent}`);
    },
  },
  {
    id: 'EVAL-I06',
    category: 'intent-classification',
    input: 'cek status laporan saya LAP-20260901-004 dong',
    expect: 'intent = null (status check is neither complaint nor service_request)',
    description: 'Status-check with ticket ref: "laporan" must NOT trigger complaint',
    run: async () => {
      const intent = classifySlotIntent('cek status laporan saya LAP-20260901-004 dong');
      check(intent === null, `expected null (status check), got ${intent}`);
    },
  },
  {
    id: 'EVAL-I07',
    category: 'intent-classification',
    input: 'mau lapor jalan berlubang sama tanya cara bikin SKTM',
    expect: 'intent = null (multi-intent ambiguity → TRIAGE, split needs LLM)',
    description: 'Multi-intent (complaint + service) in one message → null, never guessed',
    run: async () => {
      const intent = classifySlotIntent('mau lapor jalan berlubang sama tanya cara bikin SKTM');
      check(intent === null, `expected null (multi-intent ambiguity), got ${intent}`);
    },
  },
  {
    id: 'EVAL-I08',
    category: 'intent-classification',
    input: 'minta tolong dong min',
    expect: 'intent = null (vague, stays TRIAGE)',
    description: 'Vague plea with no signal → null, pipeline asks for clarification',
    run: async () => {
      const intent = classifySlotIntent('minta tolong dong min');
      check(intent === null, `expected null (vague), got ${intent}`);
    },
  },
  {
    id: 'EVAL-I09',
    category: 'intent-classification',
    input: 'lampu jalan mati di depan balai desa RT 01/RW 02',
    expect: 'category = penerangan jalan, location contains RT 01/RW 02',
    description: 'Slot extraction: category normalization + RT/RW location capture',
    run: async () => {
      const msg = 'lampu jalan mati di depan balai desa RT 01/RW 02';
      const slots = extractSlotsDeterministic(msg, 'complaint');
      check(slots.category === 'penerangan jalan', `expected 'penerangan jalan', got '${slots.category}'`);
      check(!!slots.location && slots.location.includes('RT 01/RW 02'),
        `expected location to contain RT 01/RW 02, got '${slots.location}'`);
    },
  },
  {
    id: 'EVAL-I10',
    category: 'intent-classification',
    input: 'jalan berlubang parah, sudah dua minggu tidak diperbaiki',
    expect: 'category = jalan rusak; "jalan berlubang" NOT misread as street; free text → description',
    description: 'Descriptor stoplist: damage words are never stored as a street name',
    run: async () => {
      const msg = 'jalan berlubang parah, sudah dua minggu tidak diperbaiki';
      const slots = extractSlotsDeterministic(msg, 'complaint', 'description');
      check(slots.category === 'jalan rusak', `expected category 'jalan rusak', got '${slots.category}'`);
      // STREET_DESCRIPTOR_STOPLIST: "berlubang" is a damage descriptor, so the
      // generic "jalan X" capture must NOT fire — description text is never
      // stored as a street name. With no location parsed, the free text is
      // the description (the FSM was asking for it).
      check(slots.location === undefined,
        `no location may be extracted from damage descriptors, got '${slots.location}'`);
      check(slots.description === msg,
        `free text must become the description, got '${slots.description}'`);
    },
  },
];
