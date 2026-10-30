/**
 * Identitas AI per desa — unit test.
 *
 * Mencakup:
 * 1. village-identity.service: fail-open ke default bila dashboard tak terjangkau;
 *    normalisasi nama kosong -> "Gana"; cache 60 detik.
 * 2. prompt-builder (v2): varian disclosure true/false, nama custom, persona,
 *    dan memoization per varian (prefix cache tetap per varian).
 * 3. agent-prompt (v1): varian identity di buildAgentSystemPrompt.
 * 4. system-prompt (v1 blocks): buildPromptCore + getAdaptiveSystemPrompt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('village-identity.service', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fail-open ke default bila dashboard tak terjangkau', async () => {
    vi.doMock('axios', () => ({
      default: { get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
    }));
    const mod = await import('../../services/village-identity.service');
    mod.__clearIdentityCache();
    const id = await mod.getVillageIdentity('desa-x');
    expect(id).toEqual({ disclosure: true, personaName: 'Gana', personaDescription: null });
  });

  it('fail-open ke default bila villageId kosong', async () => {
    const mod = await import('../../services/village-identity.service');
    const id = await mod.getVillageIdentity('');
    expect(id.disclosure).toBe(true);
    expect(id.personaName).toBe('Gana');
  });

  it('normalisasi: nama kosong -> Gana, disclosure eksplisit false dihormati', async () => {
    vi.doMock('axios', () => ({
      default: {
        get: vi.fn().mockResolvedValue({
          data: { data: { ai_identity: { disclosure: false, persona_name: '   ', persona_description: 'santai' } } },
        }),
      },
    }));
    const mod = await import('../../services/village-identity.service');
    mod.__clearIdentityCache();
    const id = await mod.getVillageIdentity('desa-y');
    expect(id.disclosure).toBe(false);
    expect(id.personaName).toBe('Gana');
    expect(id.personaDescription).toBe('santai');
  });

  it('cache: HTTP hanya dipanggil sekali untuk dua panggilan berurutan', async () => {
    const get = vi.fn().mockResolvedValue({ data: { data: { ai_identity: { disclosure: true } } } });
    vi.doMock('axios', () => ({ default: { get } }));
    const mod = await import('../../services/village-identity.service');
    mod.__clearIdentityCache();
    await mod.getVillageIdentity('desa-z');
    await mod.getVillageIdentity('desa-z');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('v2 prompt-builder identity', () => {
  it('disclosure=true menyebut "asisten AI resmi"; disclosure=false tidak menyebut AI', async () => {
    const { buildStaticSystemPrompt } = await import('../prompt-builder');
    const open = buildStaticSystemPrompt({ disclosure: true, personaName: 'Gana', personaDescription: null });
    expect(open).toContain('asisten AI resmi');
    expect(open).toContain('Gana');
    const hidden = buildStaticSystemPrompt({ disclosure: false, personaName: 'Gana', personaDescription: null });
    expect(hidden).not.toContain('asisten AI resmi');
    expect(hidden).toContain('Gana');
    // hidden mode: tidak boleh mengaku manusia/petugas desa
    expect(hidden).toContain('Jangan pernah mengaku sebagai manusia atau petugas desa');
  });

  it('nama persona custom dan deskripsi persona masuk prompt', async () => {
    const { buildStaticSystemPrompt } = await import('../prompt-builder');
    const p = buildStaticSystemPrompt({
      disclosure: true,
      personaName: 'Sari',
      personaDescription: 'gunakan bahasa Jawa halus',
    });
    expect(p).toContain('Sari');
    expect(p).not.toContain('Gana');
    expect(p).toContain('gunakan bahasa Jawa halus');
  });

  it('memoization: varian sama -> string identik (prefix cache aman)', async () => {
    const { buildStaticSystemPrompt } = await import('../prompt-builder');
    const a = buildStaticSystemPrompt({ disclosure: false, personaName: 'Budi', personaDescription: null });
    const b = buildStaticSystemPrompt({ disclosure: false, personaName: 'Budi', personaDescription: null });
    expect(a).toBe(b);
  });

  it('default tanpa argumen = transparan Gana', async () => {
    const { buildStaticSystemPrompt } = await import('../prompt-builder');
    const p = buildStaticSystemPrompt();
    expect(p).toContain('Gana, asisten AI resmi');
  });
});

describe('v1 agent-prompt identity', () => {
  it('disclosure=true: menyebut asisten AI resmi, bukan petugas manusia', async () => {
    const { buildAgentSystemPrompt } = await import('../../services/agent/agent-prompt');
    const p = buildAgentSystemPrompt({
      currentDatetime: 'x',
      identity: { disclosure: true, personaName: 'Gana', personaDescription: null },
    });
    expect(p).toContain('asisten AI resmi');
    expect(p).toContain('bukan petugas manusia');
  });

  it('disclosure=false: tidak menyuruh mengaku manusia; larangan sebut AI tetap longgar bila ditanya', async () => {
    const { buildAgentSystemPrompt } = await import('../../services/agent/agent-prompt');
    const p = buildAgentSystemPrompt({
      currentDatetime: 'x',
      identity: { disclosure: false, personaName: 'Gana', personaDescription: null },
    });
    expect(p).not.toContain('asisten AI resmi');
    expect(p).toContain('Jangan pernah mengaku sebagai manusia atau petugas desa');
    expect(p).toContain('jawab jujur bahwa Anda adalah asisten AI');
  });

  it('nama custom dipakai; tanpa identity -> default transparan', async () => {
    const { buildAgentSystemPrompt } = await import('../../services/agent/agent-prompt');
    const custom = buildAgentSystemPrompt({
      currentDatetime: 'x',
      identity: { disclosure: true, personaName: 'Sari', personaDescription: null },
    });
    expect(custom).toContain('Sari');
    const def = buildAgentSystemPrompt({ currentDatetime: 'x' });
    expect(def).toContain('Gana');
    expect(def).toContain('asisten AI resmi');
  });
});

describe('v1 system-prompt blocks identity', () => {
  it('buildPromptCore: varian disclosure dan nama custom', async () => {
    const { buildPromptCore } = await import('../../prompts/system-prompt');
    const open = buildPromptCore({ disclosure: true, personaName: 'Gana', personaDescription: null });
    expect(open).toContain('asisten AI resmi');
    const hidden = buildPromptCore({ disclosure: false, personaName: 'Dewi', personaDescription: 'santai' });
    expect(hidden).toContain('Dewi');
    expect(hidden).not.toContain('asisten AI resmi');
    expect(hidden).toContain('Persona dari admin desa: santai');
  });

  it('getAdaptiveSystemPrompt meneruskan identity ke core', async () => {
    const { getAdaptiveSystemPrompt } = await import('../../prompts/system-prompt');
    const p = getAdaptiveSystemPrompt('knowledge', true, {
      disclosure: false,
      personaName: 'Dewi',
      personaDescription: null,
    });
    expect(p).toContain('Dewi');
    expect(p).not.toContain('asisten AI resmi');
  });

  it('getFullSystemPrompt default = transparan Gana', async () => {
    const { getFullSystemPrompt } = await import('../../prompts/system-prompt');
    expect(getFullSystemPrompt()).toContain('asisten AI resmi');
  });
});
