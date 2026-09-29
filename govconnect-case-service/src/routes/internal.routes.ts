import { Router, Request, Response } from 'express';
import { internalAuth } from '../middleware/auth.middleware';
import { handleDeliveryCallback } from '../controllers/internal.controller';
import prisma from '../config/database';
import logger from '../utils/logger';

const router: Router = Router();

router.post('/delivery-callback', internalAuth, handleDeliveryCallback);

/**
 * R11 — month-bounded aggregates for the monthly government report.
 * GET /internal/report/monthly?village_id=…&year=2026&month=9
 *
 * All counts are scoped to created_at within [start, end) and exclude
 * soft-deleted rows. Resolution time is approximated as
 * updated_at − created_at for DONE tickets (no status-history table
 * exists yet — the approximation is labeled in the response).
 */
router.get('/report/monthly', internalAuth, async (req: Request, res: Response) => {
  try {
    const village_id = String(req.query.village_id ?? '');
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!village_id) return res.status(400).json({ error: 'village_id required' });
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'year must be a valid year' });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'month must be 1-12' });
    }

    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const base = {
      village_id,
      deleted_at: null,
      created_at: { gte: start, lt: end },
    };

    const [complaintStatus, complaintCategory, complaintChannel, complaintResolved, serviceStatus, serviceTop, serviceChannel, serviceResolved] =
      await Promise.all([
        prisma.complaint.groupBy({ by: ['status'], where: base, _count: { status: true } }),
        prisma.complaint.groupBy({
          by: ['kategori'], where: base, _count: { kategori: true },
          orderBy: { _count: { kategori: 'desc' } }, take: 10,
        }),
        prisma.complaint.groupBy({ by: ['channel', 'status'], where: base, _count: { status: true } }),
        prisma.complaint.findMany({
          where: { ...base, status: 'DONE' },
          select: { created_at: true, updated_at: true },
          take: 5000,
        }),
        prisma.serviceRequest.groupBy({ by: ['status'], where: base, _count: { status: true } }),
        prisma.serviceRequest.groupBy({
          by: ['service_id'], where: base, _count: { service_id: true },
          orderBy: { _count: { service_id: 'desc' } }, take: 10,
        }),
        prisma.serviceRequest.groupBy({ by: ['channel', 'status'], where: base, _count: { status: true } }),
        prisma.serviceRequest.findMany({
          where: { ...base, status: 'DONE' },
          select: { created_at: true, updated_at: true },
          take: 5000,
        }),
      ]);

    const toMap = <T extends { _count: Record<string, number> }>(rows: T[], key: keyof T) => {
      const m: Record<string, number> = {};
      for (const r of rows) m[String(r[key])] = (r._count as any)[String(key)] ?? 0;
      return m;
    };
    const toMatrix = (rows: Array<{ channel: string; status: string; _count: { status: number } }>) => {
      const m: Record<string, Record<string, number>> = {};
      for (const r of rows) {
        const ch = String(r.channel);
        m[ch] = m[ch] ?? {};
        m[ch][String(r.status)] = r._count.status;
      }
      return m;
    };
    const resolution = (rows: Array<{ created_at: Date; updated_at: Date }>) => {
      const hours = rows
        .map((r) => (r.updated_at.getTime() - r.created_at.getTime()) / 3_600_000)
        .filter((h) => h >= 0);
      return {
        resolved_count: rows.length,
        avg_hours: hours.length > 0 ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
        note: 'Approximation: updated_at − created_at for DONE tickets (no status-history table yet).',
      };
    };
    const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

    const complaintByStatus = toMap(complaintStatus, 'status');
    const serviceByStatus = toMap(serviceStatus, 'status');

    res.json({
      village_id,
      period: { year, month, start: start.toISOString(), end: end.toISOString() },
      cut_off: end.toISOString(),
      complaints: {
        total: sum(complaintByStatus),
        by_status: complaintByStatus,
        by_category: complaintCategory.map((r) => ({ kategori: r.kategori, count: r._count.kategori })),
        channel_status_matrix: toMatrix(complaintChannel as any),
        resolution: resolution(complaintResolved),
      },
      service_requests: {
        total: sum(serviceByStatus),
        by_status: serviceByStatus,
        by_service: serviceTop.map((r) => ({ service_id: r.service_id, count: r._count.service_id })),
        channel_status_matrix: toMatrix(serviceChannel as any),
        resolution: resolution(serviceResolved),
      },
    });
  } catch (error) {
    logger.error('Error building monthly report aggregates', {
      service: 'case-service',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ error: 'Failed to build monthly report aggregates' });
  }
});

export default router;
