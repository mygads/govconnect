import { randomUUID } from 'crypto';
import prisma from '../config/database';

type AuditLogInput = {
  village_id?: string | null;
  admin_id?: string | null;
  admin_role?: string | null;
  admin_name?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAuditLog(input: AuditLogInput) {
  const id = `audit_${randomUUID()}`;
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

  await prisma.$executeRaw`
    INSERT INTO cases.case_audit_logs (id, village_id, admin_id, admin_role, admin_name, action, entity_type, entity_id, entity_label, reason, metadata)
    VALUES (${id}, ${input.village_id || null}, ${input.admin_id || null}, ${input.admin_role || null}, ${input.admin_name || null}, ${input.action}, ${input.entity_type}, ${input.entity_id}, ${input.entity_label || null}, ${input.reason || null}, ${metadata}::jsonb)
  `;
}
