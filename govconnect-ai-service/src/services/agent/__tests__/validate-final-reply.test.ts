/**
 * Regression tests for validateFinalAgentReply's phone-fabrication guard.
 *
 * Critical safety case: a fire/medical emergency caller ("kebakaran!") must
 * NEVER be given a phone number the model invented. Numbers are only trustworthy
 * when sourced from a contact tool (get_emergency_contacts / get_important_contact
 * / get_village_profile). The guard must fire even when the user did not literally
 * ask for a "nomor", because in emergencies they describe the situation, not the
 * request.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { validateFinalAgentReply } from '../agent-orchestrator';

const CONTACT_TOOLS = ['get_emergency_contacts'];

describe('validateFinalAgentReply — phone fabrication guard', () => {
  it('blocks a fabricated damkar number in an emergency when no contact tool was used', () => {
    const userMessage = 'tolong ada kebakaran di rumah tetangga RT 04 sekarang apinya besar!';
    const reply = 'Pastikan Bapak sudah menghubungi Damkar di 113 atau 085242344116 untuk penanganan segera ya.';
    const out = validateFinalAgentReply(reply, [], userMessage);
    expect(out).not.toContain('085242344116');
    expect(out.toLowerCase()).toContain('darurat');
  });

  it('blocks an ungrounded number even when the user never said "nomor"', () => {
    const userMessage = 'ada orang kecelakaan parah di depan pasar';
    const reply = 'Segera hubungi ambulans di 0812-3456-7890 ya Pak.';
    const out = validateFinalAgentReply(reply, [], userMessage);
    expect(out).not.toContain('0812-3456-7890');
  });

  it('blocks a fabricated number for a plain contact ask (non-emergency wording)', () => {
    const userMessage = 'nomor kantor desa berapa?';
    const reply = 'Nomor kantor desa adalah 081299998888.';
    const out = validateFinalAgentReply(reply, [], userMessage);
    expect(out).not.toContain('081299998888');
  });

  it('accepts a number when a contact tool was actually used', () => {
    const userMessage = 'ada kebakaran tolong';
    const reply = 'Damkar Bola: 082190001003. Segera hubungi ya Pak.';
    const out = validateFinalAgentReply(reply, CONTACT_TOOLS, userMessage);
    expect(out).toContain('082190001003');
  });

  it('does not mangle a LAP reference code (not a phone number)', () => {
    const userMessage = 'status laporan saya';
    const reply = 'Laporan LAP-20260622-006 saat ini menunggu diproses.';
    const out = validateFinalAgentReply(reply, [], userMessage);
    expect(out).toContain('LAP-20260622-006');
  });
});
