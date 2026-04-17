/**
 * Audit Trail Logger (Fase 3.7)
 * 
 * Logs admin actions to the activity_logs table.
 * Use this in all state-changing API routes.
 * 
 * Usage:
 *   import { logAdminAction } from '@/lib/audit'
 *   await logAdminAction({
 *     adminId: session.adminId,
 *     action: 'update_status',
 *     resource: `complaint:${complaintId}`,
 *     details: { oldStatus, newStatus },
 *     ipAddress: request.headers.get('x-forwarded-for'),
 *   })
 */

import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export interface AuditLogEntry {
  adminId: string
  action: string
  resource: string
  details?: Record<string, unknown>
  ipAddress?: string | null
}

/**
 * Log an admin action to activity_logs table
 */
export async function logAdminAction(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.activity_logs.create({
      data: {
        admin_id: entry.adminId,
        action: entry.action,
        resource: entry.resource,
        details: (entry.details || {}) as Prisma.InputJsonValue,
        ip_address: entry.ipAddress || null,
      },
    })
  } catch (error) {
    // Non-blocking: don't fail the request if audit logging fails
    console.error('Failed to log admin action:', error)
  }
}

/**
 * Common audit action names
 */
export const AuditActions = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  CREATE_KB: 'create_knowledge',
  UPDATE_KB: 'update_knowledge',
  DELETE_KB: 'delete_knowledge',
  UPDATE_STATUS: 'update_status',
  CREATE_COMPLAINT_TYPE: 'create_complaint_type',
  UPDATE_COMPLAINT_TYPE: 'update_complaint_type',
  DELETE_COMPLAINT_TYPE: 'delete_complaint_type',
  UPLOAD_DOCUMENT: 'upload_document',
  DELETE_DOCUMENT: 'delete_document',
  UPDATE_SETTINGS: 'update_settings',
  VIEW_COMPLAINT: 'view_complaint',
  VIEW_DASHBOARD: 'view_dashboard',
} as const
