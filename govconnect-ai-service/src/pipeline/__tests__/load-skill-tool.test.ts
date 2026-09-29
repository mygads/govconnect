/**
 * R4: load_skill tool registration — definitions, grades, stage allowlists.
 * Import-safe (no prisma chain).
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS } from '../../services/agent/tool-definitions';
import { TOOL_GRADES, STAGE_TOOL_ALLOWLIST } from '../../gateway/tool-policy';

describe('load_skill registration', () => {
  it('is defined in AGENT_TOOLS with a slug parameter', () => {
    const def = AGENT_TOOLS.find((t) => t.function.name === 'load_skill');
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toContain('slug');
  });

  it('is graded G0 (read-only)', () => {
    expect(TOOL_GRADES.load_skill).toBe('G0');
  });

  it('is allowlisted for INFORMATION and COLLECT, blocked elsewhere', () => {
    expect(STAGE_TOOL_ALLOWLIST.INFORMATION.has('load_skill')).toBe(true);
    expect(STAGE_TOOL_ALLOWLIST.COLLECT.has('load_skill')).toBe(true);
    expect(STAGE_TOOL_ALLOWLIST.VERIFY.has('load_skill')).toBe(false);
    expect(STAGE_TOOL_ALLOWLIST.EXECUTE.has('load_skill')).toBe(false);
    expect(STAGE_TOOL_ALLOWLIST.EMERGENCY.has('load_skill')).toBe(false);
  });
});
