/**
 * Unit tests untuk fitur "pintar banget":
 *  - improvement-loop.service (redactPii, suggestImprovements)
 *  - confidence-clarification.service (shouldClarify, parseClarificationAnswer)
 *  - last-interaction.service (redactPiiForMemory, formatLastInteractionForPrompt)
 *  - proactive-followup.service (generateFollowupMessage)
 */

import { describe, it, expect } from 'vitest';

import {
  redactPii,
  suggestImprovements,
  type FailurePattern,
} from '../improvement-loop.service';

import {
  shouldClarify,
  parseClarificationAnswer,
  LOW_CONFIDENCE_THRESHOLD,
} from '../confidence-clarification.service';

import {
  redactPiiForMemory,
  formatLastInteractionForPrompt,
} from '../last-interaction.service';

import {
  generateFollowupMessage,
  type StaleComplaint,
} from '../proactive-followup.service';

// ---------------------------------------------------------------------------
// improvement-loop
// ---------------------------------------------------------------------------

describe('improvement-loop: redactPii', () => {
  it('redacts 16-digit NIK', () => {
    const out = redactPii('NIK saya 1234567890123456 tolong cek');
    expect(out).toContain('[NIK_REDACTED]');
    expect(out).not.toContain('1234567890123456');
  });

  it('redacts Indonesian phone numbers', () => {
    const out = redactPii('hubungi 081234567890 ya');
    expect(out).toContain('[PHONE_REDACTED]');
    expect(out).not.toContain('081234567890');
  });

  it('redacts email addresses', () => {
    const out = redactPii('email saya budi@example.com');
    expect(out).toContain('[EMAIL_REDACTED]');
    expect(out).not.toContain('budi@example.com');
  });

  it('truncates long messages to 500 chars', () => {
    const out = redactPii('x'.repeat(1000));
    expect(out.length).toBeLessThanOrEqual(500);
  });
});

describe('improvement-loop: suggestImprovements', () => {
  const mkPattern = (over: Partial<FailurePattern>): FailurePattern => ({
    failure_type: 'fallback',
    stage: 'TRIAGE',
    count: 10,
    sample_messages: ['syarat bikin sim apa?'],
    first_seen: new Date(),
    last_seen: new Date(),
    ...over,
  });

  it('generates KB suggestion for frequent fallbacks', () => {
    const s = suggestImprovements([mkPattern({ failure_type: 'fallback', count: 8 })]);
    expect(s).toHaveLength(1);
    expect(s[0].suggestion_type).toBe('add_kb_document');
  });

  it('generates variant suggestion for low_confidence', () => {
    const s = suggestImprovements([mkPattern({ failure_type: 'low_confidence', count: 6 })]);
    expect(s).toHaveLength(1);
    expect(s[0].suggestion_type).toBe('add_question_variant');
  });

  it('ignores patterns below threshold', () => {
    const s = suggestImprovements([mkPattern({ count: 3 })], 5);
    expect(s).toHaveLength(0);
  });

  it('marks high priority for very frequent patterns', () => {
    const s = suggestImprovements([mkPattern({ count: 20 })], 5);
    expect(s[0].priority).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// confidence-clarification
// ---------------------------------------------------------------------------

describe('confidence-clarification: shouldClarify', () => {
  it('does not clarify when confidence is high', () => {
    expect(shouldClarify(0.9, 'INFORMATION').needed).toBe(false);
  });

  it('does not clarify at exactly the threshold', () => {
    expect(shouldClarify(LOW_CONFIDENCE_THRESHOLD, 'INFORMATION').needed).toBe(false);
  });

  it('clarifies when confidence is below threshold but not too low', () => {
    const r = shouldClarify(0.45, 'COLLECT', ['INFORMATION']);
    expect(r.needed).toBe(true);
    expect(r.question).toContain('(a)');
    expect(r.question).toContain('(b)');
    expect(r.candidates).toHaveLength(2);
  });

  it('does not clarify when confidence is extremely low (< 0.3)', () => {
    // Terlalu rendah -> serahkan ke handoff logic, bukan klarifikasi.
    expect(shouldClarify(0.2, 'TRIAGE').needed).toBe(false);
  });

  it('adds OTHER option when only one candidate', () => {
    const r = shouldClarify(0.5, 'STATUS');
    expect(r.needed).toBe(true);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates![1].stage).toBe('OTHER');
  });

  it('question is specific, not generic', () => {
    const r = shouldClarify(0.5, 'COLLECT', ['STATUS']);
    expect(r.question).not.toMatch(/maksud Anda apa\?{0}$/);
    expect(r.question).toContain('Apakah yang Anda maksud');
  });
});

describe('confidence-clarification: parseClarificationAnswer', () => {
  const candidates = [
    { label: 'mengurus surat', stage: 'COLLECT' },
    { label: 'mengecek status', stage: 'STATUS' },
  ];

  it('parses letter answers', () => {
    expect(parseClarificationAnswer('a', candidates)).toBe('COLLECT');
    expect(parseClarificationAnswer('b', candidates)).toBe('STATUS');
    expect(parseClarificationAnswer('(a)', candidates)).toBe('COLLECT');
  });

  it('parses label mentions', () => {
    expect(parseClarificationAnswer('saya mau mengurus surat', candidates)).toBe('COLLECT');
  });

  it('returns null for unrecognized answers', () => {
    expect(parseClarificationAnswer('xyz tidak jelas', candidates)).toBeNull();
    expect(parseClarificationAnswer('', candidates)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// last-interaction
// ---------------------------------------------------------------------------

describe('last-interaction: redactPiiForMemory', () => {
  it('redacts NIK and phone', () => {
    const out = redactPiiForMemory('User NIK 1234567890123456 HP 081234567890 lapor jalan rusak');
    expect(out).not.toContain('1234567890123456');
    expect(out).not.toContain('081234567890');
    expect(out).toContain('lapor jalan rusak');
  });

  it('truncates to 200 chars', () => {
    expect(redactPiiForMemory('x'.repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe('last-interaction: formatLastInteractionForPrompt', () => {
  it('returns undefined for null', () => {
    expect(formatLastInteractionForPrompt(null)).toBeUndefined();
  });

  it('formats "kemarin" for 1 day ago', () => {
    const out = formatLastInteractionForPrompt({
      summary: 'user lapor jalan rusak',
      days_ago: 1,
      memory_type: 'complaint',
      created_at: new Date(),
    });
    expect(out).toContain('kemarin');
    expect(out).toContain('user lapor jalan rusak');
  });

  it('formats "3 hari lalu" correctly', () => {
    const out = formatLastInteractionForPrompt({
      summary: 'test',
      days_ago: 3,
      memory_type: 'complaint',
      created_at: new Date(),
    });
    expect(out).toContain('3 hari lalu');
  });
});

// ---------------------------------------------------------------------------
// proactive-followup
// ---------------------------------------------------------------------------

describe('proactive-followup: generateFollowupMessage', () => {
  const mkComplaint = (over: Partial<StaleComplaint>): StaleComplaint => ({
    id: 'c1',
    complaint_id: 'LAP-001',
    wa_user_id: 'w1',
    village_id: 'v1',
    kategori: 'Infrastruktur',
    deskripsi: 'Jalan rusak parah di RT 03, banyak lubang',
    rt_rw: 'RT 03',
    reporter_name: 'Pak Budi',
    status: 'OPEN',
    created_at: new Date(),
    updated_at: new Date(),
    days_stale: 4,
    ...over,
  });

  it('generates check_status message for 3-6 days stale', () => {
    const c = generateFollowupMessage(mkComplaint({ days_stale: 4 }));
    expect(c.suggested_action).toBe('check_status');
    expect(c.message).toContain('4 hari');
    expect(c.message).toContain('Pak Budi');
  });

  it('generates escalate message for 7+ days stale', () => {
    const c = generateFollowupMessage(mkComplaint({ days_stale: 8 }));
    expect(c.suggested_action).toBe('escalate');
    expect(c.message).toContain('8 hari');
  });

  it('redacts PII from deskripsi', () => {
    const c = generateFollowupMessage(
      mkComplaint({ deskripsi: 'Jalan rusak, NIK 1234567890123456' }),
    );
    expect(c.message).not.toContain('1234567890123456');
  });

  it('handles missing reporter name gracefully', () => {
    const c = generateFollowupMessage(mkComplaint({ reporter_name: null }));
    expect(c.message).toContain('Pak/Bu');
  });
});
