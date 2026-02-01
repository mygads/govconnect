import { Request, Response } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { getQueryString } from '../utils/http';
import { GOVERNMENT_SERVICES } from '../config/services';
import { isValidCitizenWaNumber, normalizeCitizenWaForStorage, sameCitizenWa } from '../utils/wa-normalizer';

type AiServiceSearchResult = {
  service_name: string;
  slug: string;
  requirements: string[];
  cost: number | null;
  estimated_duration: number | null;
  is_active: boolean;
};

type AiServiceRequestStatus = 'PENDING' | 'DONE' | 'REJECTED';

function mapServiceRequestStatus(status: string): AiServiceRequestStatus {
  if (status === 'selesai') return 'DONE';
  if (status === 'ditolak') return 'REJECTED';
  if (status === 'dibatalkan') return 'REJECTED';
  return 'PENDING';
}

function lookupEstimatedDurationMinutes(serviceName: string): number | null {
  const match = GOVERNMENT_SERVICES.find(
    (s) => s.name.trim().toLowerCase() === serviceName.trim().toLowerCase()
  );
  return match ? match.estimated_duration : null;
}

function lookupDefaultRequirements(serviceName: string): string[] {
  const match = GOVERNMENT_SERVICES.find(
    (s) => s.name.trim().toLowerCase() === serviceName.trim().toLowerCase()
  );
  return match ? match.requirements : [];
}

export class InternalServiceController {
  static async searchServicesForAI(req: Request, res: Response) {
    try {
      const qRaw = getQueryString(req.query.q);
      const villageId = getQueryString(req.query.village_id);

      const q = (qRaw || '').trim();
      if (!villageId) {
        return res.status(400).json({ error: 'village_id is required' });
      }
      if (!q) {
        return res.status(400).json({ error: 'q is required' });
      }

      const services = await prisma.serviceItem.findMany({
        where: {
          village_id: villageId,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        },
        include: {
          requirements: {
            orderBy: { order_index: 'asc' },
          },
        },
        orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
        take: 10,
      });

      const data: AiServiceSearchResult[] = services.map((service) => {
        const reqsFromDb = service.requirements.map((r) => r.label);
        const requirements = reqsFromDb.length > 0 ? reqsFromDb : lookupDefaultRequirements(service.name);

        return {
          service_name: service.name,
          slug: service.slug,
          requirements,
          cost: null,
          estimated_duration: lookupEstimatedDurationMinutes(service.name),
          is_active: service.is_active,
        };
      });

      return res.json({ data });
    } catch (error: any) {
      logger.error('Internal search services for AI error', { error: error.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async checkRequestStatus(req: Request, res: Response) {
    try {
      const requestCode = getQueryString(req.query.request_code);
      const phoneNumberRaw = getQueryString(req.query.phone_number);

      if (!requestCode) {
        return res.status(400).json({ error: 'request_code is required' });
      }
      if (!phoneNumberRaw) {
        return res.status(400).json({ error: 'phone_number is required' });
      }

      const normalizedPhone = normalizeCitizenWaForStorage(String(phoneNumberRaw));
      if (!isValidCitizenWaNumber(normalizedPhone)) {
        return res.status(400).json({ error: 'phone_number tidak valid. Gunakan format 628xxxxxxxxxx atau 08xxxxxxxxxx' });
      }

      const request = await prisma.serviceRequest.findFirst({
        where: {
          OR: [{ request_number: requestCode }, { id: requestCode }],
        },
        select: {
          request_number: true,
          wa_user_id: true,
          status: true,
          admin_notes: true,
          updated_at: true,
        },
      });

      if (!request) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }

      if (!sameCitizenWa(request.wa_user_id, normalizedPhone)) {
        return res.status(403).json({ error: 'NOT_OWNER' });
      }

      const mappedStatus = mapServiceRequestStatus(request.status);

      return res.json({
        status: mappedStatus,
        current_step: request.status,
        last_updated: request.updated_at,
        notes: mappedStatus === 'REJECTED' ? request.admin_notes ?? null : null,
      });
    } catch (error: any) {
      logger.error('Internal check request status error', { error: error.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
