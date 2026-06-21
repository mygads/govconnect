/**
 * Answer policy verifier tests.
 *
 * Covers the five cases that must never regress:
 *   1. Agent answered a contact-directory question WITHOUT using any contact
 *      tool → rewrite to "belum ditemukan".
 *   2. Agent answered with a phone-shaped number but never called a contact
 *      tool → rewrite.
 *   3. Agent grounded the contact answer via `get_important_contact` → accept.
 *   4. Agent answered "layanan apa aja" with a bullet list but did NOT call
 *      `get_service_info` → rewrite.
 *   5. Guards-prevalidated results always pass through untouched.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({
  config: {
    dashboardServiceUrl: 'http://dashboard.local',
    internalApiKey: 'test-key',
  },
}));

import { verifyAnswer } from '../answer-policy.service';
import type { ProcessMessageResult } from '../ump-types';

function baseResult(overrides: Partial<ProcessMessageResult>): ProcessMessageResult {
  return {
    success: true,
    response: 'dummy',
    intent: 'QUESTION',
    ...overrides,
    metadata: {
      processingTimeMs: 1,
      hasKnowledge: false,
      agentMode: 'single_orchestrator',
      traceId: 'trace-test',
      toolsUsed: [],
      ...(overrides.metadata || {}),
    },
  } as ProcessMessageResult;
}

describe('verifyAnswer — contact directory grounding', () => {
  it('rewrites a contact-directory answer when no contact tool was used', async () => {
    const result = baseResult({
      intent: 'CONTACT_DIRECTORY',
      response: 'Nomor damkar adalah 081234567890.',
    });

    const decision = await verifyAnswer({
      userMessage: 'ada nomor damkar?',
      result,
      toolsUsed: ['search_knowledge'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.rewritten).toBe(true);
    expect(decision.kind).toBe('structured_fact_contact');
    expect(decision.replacement?.response || '').toMatch(/belum menemukan|belum ditemukan/i);
  });

  it('rewrites when the response contains a phone-shaped number without a contact tool', async () => {
    const result = baseResult({
      intent: 'QUESTION',
      response: 'Silakan hubungi 081234567890.',
    });

    const decision = await verifyAnswer({
      userMessage: 'ada nomor kepala desa?',
      result,
      toolsUsed: ['search_knowledge'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.rewritten).toBe(true);
    expect(decision.reason).toBe('contact_number_without_tool');
  });

  it('accepts a contact-directory answer when get_important_contact was used', async () => {
    const result = baseResult({
      intent: 'CONTACT_DIRECTORY',
      response: '*Damkar Bola*\n0200-123456',
    });

    const decision = await verifyAnswer({
      userMessage: 'ada nomor damkar?',
      result,
      toolsUsed: ['get_important_contact'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.rewritten).toBe(false);
    expect(decision.reason).toBe('grounded_via_contact_tool');
  });

  it('accepts a contact-directory answer when trusted toolTrace proves directory grounding', async () => {
    const result = baseResult({
      intent: 'CONTACT_DIRECTORY',
      response: '*Damkar Bola*\n0200-123456',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId: 'trace-test',
        toolsUsed: [],
        toolTrace: [{
          tool: 'get_important_contact',
          success: true,
          durationMs: 10,
          trustLevel: 'trusted_fact',
          sourceKind: 'contact_directory_lookup',
        }],
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'ada nomor damkar?',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe('grounded_via_contact_tool');
  });

  it('accepts when emergency tool was used for an active-emergency reply', async () => {
    const result = baseResult({
      intent: 'EMERGENCY_CONTACTS',
      response: '*Damkar Bola*\n0200-123456',
    });

    const decision = await verifyAnswer({
      userMessage: 'rumah saya kebakaran',
      result,
      toolsUsed: ['get_emergency_contacts'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
  });
});

describe('verifyAnswer — service listing grounding', () => {
  it('rewrites a list-shaped service answer when get_service_info was not used', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response:
        'Berikut beberapa layanan yang tersedia:\n\n1. Surat Domisili\n2. KTP\n3. KK\n\nMohon sebutkan yang Bapak/Ibu maksud.',
    });

    const decision = await verifyAnswer({
      userMessage: 'layanan apa aja yg bisa dilakukan disini?',
      result,
      toolsUsed: ['search_knowledge'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.rewritten).toBe(true);
    expect(decision.kind).toBe('structured_fact_service_listing');
  });

  it('rewrites service-listing variants when get_service_info was not used', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Berikut layanan:\n\n- Surat Domisili\n- KTP',
    });

    for (const userMessage of ['pelayanan desa apa aja?', 'bisa urus apa aja di sini?']) {
      const decision = await verifyAnswer({
        userMessage,
        result,
        toolsUsed: ['search_knowledge'],
        handledByGuard: false,
      });

      expect(decision.ok).toBe(false);
      expect(decision.kind).toBe('structured_fact_service_listing');
    }
  });

  it('accepts a listing answer grounded in get_service_info', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Berikut layanan:\n\n1. Surat Domisili\n2. KTP',
    });

    const decision = await verifyAnswer({
      userMessage: 'layanan apa aja',
      result,
      toolsUsed: ['get_service_info'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe('grounded_via_service_tool');
  });

  it('does not flag a specific-service detail question as listing', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Syarat KTP di Margahayu adalah KK dan formulir F1.',
    });

    const decision = await verifyAnswer({
      userMessage: 'syarat KTP apa?',
      result,
      toolsUsed: ['get_service_info'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
  });
});

describe('verifyAnswer — guard pass-through', () => {
  it('accepts any result that was handled by a pre-agent guard', async () => {
    const result = baseResult({
      intent: 'CONTACT_DIRECTORY',
      response: 'Nomor tidak jelas disebut tapi guard sudah pre-validate.',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'pre_agent_guard',
        traceId: 'trace-test',
        toolsUsed: [],
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'ada nomor damkar?',
      result,
      toolsUsed: [],
      handledByGuard: true,
    });

    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe('guard_prevalidated');
  });
});

describe('verifyAnswer — non-structured passthrough', () => {
  it('leaves generic knowledge answers untouched', async () => {
    const result = baseResult({
      intent: 'KNOWLEDGE_QUERY',
      response: 'Silakan datang ke kantor desa untuk konfirmasi.',
    });

    const decision = await verifyAnswer({
      userMessage: 'apa itu govconnect?',
      result,
      toolsUsed: ['search_knowledge'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.rewritten).toBe(false);
  });
});

describe('verifyAnswer — mixed structured grounding', () => {
  it('rewrites mixed service-and-contact answers when contact grounding exists but service grounding is missing', async () => {
    const result = baseResult({
      intent: 'QUESTION',
      response: 'Syarat Surat Keterangan Domisili adalah KTP dan KK. Nomor puskesmas 081234567890.',
    });

    const decision = await verifyAnswer({
      userMessage: 'syarat surat domisili dan nomor puskesmas berapa?',
      result,
      toolsUsed: ['get_important_contact'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_service_detail');
    expect(decision.reason).toBe('service_detail_without_tool');
  });

  it('rewrites mixed village-profile-and-contact answers when contact grounding exists but profile grounding is missing', async () => {
    const result = baseResult({
      intent: 'QUESTION',
      response: 'Kantor desa buka jam 08:00-15:00. Nomor kantor desa 081234567890.',
    });

    const decision = await verifyAnswer({
      userMessage: 'jam buka kantor desa dan nomor kantor desa berapa?',
      result,
      toolsUsed: ['get_important_contact'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_village_profile');
    expect(decision.reason).toBe('village_profile_without_tool');
  });

  it('accepts mixed service-and-contact answers when both groundings are present', async () => {
    const result = baseResult({
      intent: 'QUESTION',
      response: 'Syarat Surat Keterangan Domisili adalah KTP dan KK. Nomor puskesmas 081234567890.',
    });

    const decision = await verifyAnswer({
      userMessage: 'syarat surat domisili dan nomor puskesmas berapa?',
      result,
      toolsUsed: ['get_service_info', 'get_important_contact'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.rewritten).toBe(false);
  });
});

describe('verifyAnswer — service detail grounding', () => {
  it('rewrites ungrounded service requirement list', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Syarat KTP:\n1. KK\n2. Fotokopi akta\n3. Surat pengantar RT',
    });

    const decision = await verifyAnswer({
      userMessage: 'syarat bikin ktp apa aja?',
      result,
      toolsUsed: ['search_knowledge'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_service_detail');
    expect(decision.rewritten).toBe(true);
  });

  it('rewrites ungrounded service detail even without list shape when it makes a factual claim', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Untuk KTP biasanya gratis dan prosesnya 1 hari kerja.',
    });

    const decision = await verifyAnswer({
      userMessage: 'syarat ktp apa?',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_service_detail');
    expect(decision.rewritten).toBe(true);
  });

  it('rewrites ungrounded service availability or mode claim', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Surat domisili masih tersedia dan bisa diajukan online lewat link formulir.',
    });

    const decision = await verifyAnswer({
      userMessage: 'surat domisili bisa online kah?',
      result,
      toolsUsed: ['search_knowledge'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_service_detail');
    expect(decision.rewritten).toBe(true);
  });

  it('accepts explicit uncertainty for service detail when no service fact is claimed', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Maaf Pak, saya cek dulu ya.',
    });

    const decision = await verifyAnswer({
      userMessage: 'syarat ktp apa?',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.kind).toBe('structured_fact_service_detail');
    expect(decision.reason).toBe('explicit_uncertainty_without_service_tool');
  });

  it('accepts service detail when trusted toolTrace proves official service grounding', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Untuk KTP, syarat utamanya KK dan formulir pengajuan.',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId: 'trace-test',
        toolsUsed: [],
        toolTrace: [{
          tool: 'get_service_info',
          success: true,
          durationMs: 12,
          trustLevel: 'trusted_fact',
          sourceKind: 'official_service_info',
        }],
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'syarat ktp apa?',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe('grounded_via_service_tool');
  });

  it('does not treat edit-link tools as sufficient grounding for service detail facts', async () => {
    const result = baseResult({
      intent: 'SERVICE_INFO',
      response: 'Untuk KTP biasanya gratis dan prosesnya 1 hari kerja.',
    });

    const decision = await verifyAnswer({
      userMessage: 'biaya ktp berapa?',
      result,
      toolsUsed: ['get_service_request_edit_link'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_service_detail');
    expect(decision.rewritten).toBe(true);
  });
});

describe('verifyAnswer — village profile grounding', () => {
  it('rewrites ungrounded jam buka claim', async () => {
    const result = baseResult({
      intent: 'QUESTION',
      response: 'Kantor desa buka Senin-Jumat jam 08:00 sampai 15:00.',
    });

    const decision = await verifyAnswer({
      userMessage: 'jam buka kantor desa kapan?',
      result,
      toolsUsed: ['search_knowledge'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_village_profile');
    expect(decision.rewritten).toBe(true);
  });

  it('rewrites ungrounded location claim even without a concrete street address', async () => {
    const result = baseResult({
      intent: 'QUESTION',
      response: 'Kantor desa berada di dekat lapangan utama desa.',
    });

    const decision = await verifyAnswer({
      userMessage: 'kantor desa dimana?',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_village_profile');
    expect(decision.rewritten).toBe(true);
  });

  it('rewrites a hallucinated administrative-region address on a bare follow-up question', async () => {
    const result = baseResult({
      intent: 'AGENT',
      response: 'Alamat kantor Desa Sanreseng Ade: Sanreseng Ade, Kec. Galut, Kab. Takalar, Sulawesi Selatan.',
    });

    const decision = await verifyAnswer({
      userMessage: 'alamatnya di mana?',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('structured_fact_village_profile');
    expect(decision.rewritten).toBe(true);
  });

  it('accepts explicit uncertainty for village profile when no profile fact is claimed', async () => {
    const result = baseResult({
      intent: 'VILLAGE_PROFILE',
      response: 'Maaf Pak/Bu, untuk alamat dan jam bukanya saya cek dulu dari data resmi ya.',
    });

    const decision = await verifyAnswer({
      userMessage: 'jam buka kantor desa?',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe('explicit_uncertainty_without_profile_tool');
  });

  it('accepts village profile answer grounded by get_village_profile', async () => {
    const result = baseResult({
      intent: 'VILLAGE_PROFILE',
      response: 'Kantor desa buka Senin-Jumat jam 08:00-15:00.',
    });

    const decision = await verifyAnswer({
      userMessage: 'jam buka kantor desa?',
      result,
      toolsUsed: ['get_village_profile'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe('grounded_via_profile_tool');
  });

  it('accepts village profile answer when grounding metadata is attached', async () => {
    const result = baseResult({
      intent: 'VILLAGE_PROFILE',
      response: 'Kantor desa buka Senin-Jumat jam 08:00-15:00.',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId: 'trace-test',
        toolsUsed: [],
        grounding: {
          trustedTools: ['get_village_profile'],
          sourceKinds: ['official_village_profile'],
          hasTrustedFact: true,
          hasTrustedRecord: false,
        },
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'jam buka kantor desa?',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe('grounded_via_profile_tool');
  });
});

describe('verifyAnswer — phantom transaction guard', () => {
  it('rewrites a "laporan sudah masuk" claim when no create tool ran (intent AGENT)', async () => {
    const result = baseResult({
      intent: 'AGENT',
      response: 'Terima kasih Pak Andi. Saya catat laporannya. Laporan masuk ya, nanti kami teruskan ke petugas desa untuk ditindaklanjuti.',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId: 'trace-test',
        toolsUsed: ['search_knowledge'],
        toolTrace: [{
          tool: 'search_knowledge',
          success: true,
          durationMs: 10,
          trustLevel: 'untrusted_retrieval',
          sourceKind: 'knowledge_retrieval',
        }],
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'ya betul, proses ya',
      result,
      toolsUsed: ['search_knowledge'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('transactional_update');
    expect(decision.reason).toBe('transaction_success_without_tool');
    expect(decision.rewritten).toBe(true);
  });

  it('accepts a transaction-success claim grounded by create_complaint', async () => {
    const result = baseResult({
      intent: 'CREATE_COMPLAINT',
      response: 'Laporan berhasil dibuat dengan nomor LAP-2026-0001. Akan kami tindak lanjuti ya Pak.',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId: 'trace-test',
        toolsUsed: ['create_complaint'],
        toolTrace: [{
          tool: 'create_complaint',
          success: true,
          durationMs: 10,
          trustLevel: 'action_result',
          sourceKind: 'complaint_creation',
        }],
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'ya betul, proses ya',
      result,
      toolsUsed: ['create_complaint'],
      handledByGuard: false,
    });

    expect(decision.ok).toBe(true);
  });

  it('does not flag a future-tense offer to help record the report', async () => {
    const result = baseResult({
      intent: 'CREATE_COMPLAINT',
      response: 'Baik Pak, nanti saya bantu catat laporannya. Boleh sebutkan lokasi dan nama Bapak dulu?',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId: 'trace-test',
        toolsUsed: [],
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'mau lapor jalan rusak',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.reason).not.toBe('transaction_success_without_tool');
  });

  it('accepts a history/status reply describing an existing complaint (grounded by get_my_history)', async () => {
    const result = baseResult({
      intent: 'HISTORY',
      response: 'Laporan LAP-20260621-001 sudah kami terima dan tercatat, statusnya menunggu diproses.',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId: 'trace-test',
        toolsUsed: ['get_my_history'],
        toolTrace: [{
          tool: 'get_my_history',
          success: true,
          durationMs: 10,
          trustLevel: 'action_result',
          sourceKind: 'user_history',
        }],
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'riwayat laporan saya',
      result,
      toolsUsed: ['get_my_history'],
      handledByGuard: false,
    });

    expect(decision.reason).not.toBe('transaction_success_without_tool');
  });

  it('does not flag a cancel-confirmation prompt that merely cites a LAP code', async () => {
    const result = baseResult({
      intent: 'CANCEL_COMPLAINT',
      response: 'Apakah Bapak/Ibu yakin ingin membatalkan laporan LAP-20260621-002?\nBalas YA untuk konfirmasi.',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId: 'trace-test',
        toolsUsed: [],
      },
    });

    const decision = await verifyAnswer({
      userMessage: 'batalkan laporan LAP-20260621-002',
      result,
      toolsUsed: [],
      handledByGuard: false,
    });

    expect(decision.reason).not.toBe('transaction_success_without_tool');
  });
});
