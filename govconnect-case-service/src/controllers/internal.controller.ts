import type { Request, Response } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';

type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';
type DeliveryEntityType = 'complaint' | 'service_request';

function inferEntityType(rawEntityType: unknown, referenceNumber: string): DeliveryEntityType | null {
  const normalized = typeof rawEntityType === 'string' ? rawEntityType.trim().toLowerCase() : '';
  if (normalized === 'complaint' || normalized === 'service_request') {
    return normalized;
  }
  if (referenceNumber.startsWith('LAP-')) return 'complaint';
  if (referenceNumber.startsWith('LAY-')) return 'service_request';
  return null;
}

function normalizeDeliveryStatus(raw: unknown): DeliveryStatus | null {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (normalized === 'sent' || normalized === 'delivered' || normalized === 'read' || normalized === 'failed') {
    return normalized;
  }
  return null;
}

function parseOccurredAt(raw: unknown): Date | null {
  if (typeof raw === 'undefined' || raw === null || raw === '') {
    return new Date();
  }
  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildDeliveryUpdateData(
  record: { status_notified_at: Date | null; status_delivered_at: Date | null },
  deliveryStatus: DeliveryStatus,
  occurredAt: Date,
  options?: {
    messageId?: string;
    providerStatus?: string | null;
    providerError?: string | null;
  },
) {
  const data: Record<string, unknown> = {
    last_delivery_status: options?.providerStatus?.trim() || deliveryStatus,
    last_delivery_error: deliveryStatus === 'failed' ? (options?.providerError?.trim() || null) : null,
    last_delivery_attempt_at: occurredAt,
  };

  if (options?.messageId) {
    data.last_delivery_message_id = options.messageId;
  }

  if (deliveryStatus === 'sent') {
    data.status_notified_at = record.status_notified_at ?? occurredAt;
  }

  if (deliveryStatus === 'delivered' || deliveryStatus === 'read') {
    data.status_notified_at = record.status_notified_at ?? occurredAt;
    data.status_delivered_at = record.status_delivered_at ?? occurredAt;
  }

  return data;
}

export async function handleDeliveryCallback(req: Request, res: Response) {
  try {
    const referenceNumber = String(
      req.body?.reference_number || req.body?.complaint_id || req.body?.request_number || '',
    ).trim();
    const entityType = inferEntityType(req.body?.entity_type, referenceNumber);
    const status = String(req.body?.status || '').trim().toUpperCase();
    const deliveryStatus = normalizeDeliveryStatus(req.body?.delivery_status);
    const occurredAt = parseOccurredAt(req.body?.occurred_at);
    const messageId = typeof req.body?.message_id === 'string' ? req.body.message_id.trim() : '';
    const providerStatus = typeof req.body?.provider_status === 'string' ? req.body.provider_status.trim() : '';
    const providerError = typeof req.body?.provider_error === 'string' ? req.body.provider_error.trim() : '';

    if (!referenceNumber) {
      return res.status(400).json({ error: 'reference_number, complaint_id, atau request_number wajib diisi' });
    }

    if (!entityType) {
      return res.status(400).json({ error: 'entity_type tidak valid dan tidak bisa diinfer dari reference number' });
    }

    if (!status) {
      return res.status(400).json({ error: 'status wajib diisi' });
    }

    if (!deliveryStatus) {
      return res.status(400).json({ error: 'delivery_status harus sent/delivered/read/failed' });
    }

    if (!occurredAt) {
      return res.status(400).json({ error: 'occurred_at tidak valid' });
    }

    if (entityType === 'complaint') {
      const complaint = await prisma.complaint.findUnique({
        where: { complaint_id: referenceNumber },
        select: {
          id: true,
          status: true,
          status_notified_at: true,
          status_delivered_at: true,
        },
      });

      if (!complaint) {
        return res.status(404).json({ error: 'Complaint not found' });
      }

      if (complaint.status !== status) {
        logger.info('Ignoring stale complaint delivery callback', {
          complaint_id: referenceNumber,
          callback_status: status,
          current_status: complaint.status,
          delivery_status: deliveryStatus,
        });
        return res.json({ updated: false, ignored: 'stale_status', current_status: complaint.status });
      }

      const data = buildDeliveryUpdateData(complaint, deliveryStatus, occurredAt, {
        messageId: messageId || undefined,
        providerStatus: providerStatus || undefined,
        providerError: providerError || undefined,
      });
      if (!Object.keys(data).length) {
        return res.json({ updated: false, ignored: 'no_delivery_fields' });
      }

      await prisma.complaint.update({
        where: { id: complaint.id },
        data: data as any,
      });

      return res.json({ updated: true, entity_type: entityType, reference_number: referenceNumber });
    }

    const request = await prisma.serviceRequest.findUnique({
      where: { request_number: referenceNumber },
      select: {
        id: true,
        status: true,
        status_notified_at: true,
        status_delivered_at: true,
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Service request not found' });
    }

    if (request.status !== status) {
      logger.info('Ignoring stale service request delivery callback', {
        request_number: referenceNumber,
        callback_status: status,
        current_status: request.status,
        delivery_status: deliveryStatus,
      });
      return res.json({ updated: false, ignored: 'stale_status', current_status: request.status });
    }

    const data = buildDeliveryUpdateData(request, deliveryStatus, occurredAt, {
      messageId: messageId || undefined,
      providerStatus: providerStatus || undefined,
      providerError: providerError || undefined,
    });
    if (!Object.keys(data).length) {
      return res.json({ updated: false, ignored: 'no_delivery_fields' });
    }

    await prisma.serviceRequest.update({
      where: { id: request.id },
      data: data as any,
    });

    return res.json({ updated: true, entity_type: entityType, reference_number: referenceNumber });
  } catch (error: any) {
    logger.error('Delivery callback error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
