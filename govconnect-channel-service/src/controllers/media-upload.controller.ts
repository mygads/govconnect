import type { Request, Response } from 'express';
import logger from '../utils/logger';
import { getQuery } from '../utils/http';
import { uploadBufferToObjectStorage } from '../services/object-storage.service';

function getScope(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return 'public';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

export async function handleUploadMedia(req: Request, res: Response): Promise<void> {
  try {
    const scope = getScope(getQuery(req, 'scope'));
    const villageIdRaw = getQuery(req, 'village_id') || req.headers['x-village-id'];
    const villageId = typeof villageIdRaw === 'string' ? villageIdRaw.trim() : '';
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id wajib diisi' });
      return;
    }
    const folderPrefix = `villages/${villageId}/`;

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ success: false, error: 'File tidak ditemukan' });
      return;
    }

    if (!file.buffer || file.buffer.length === 0) {
      res.status(400).json({ success: false, error: 'Isi file tidak ditemukan' });
      return;
    }

    const uploaded = await uploadBufferToObjectStorage({
      buffer: file.buffer,
      contentType: file.mimetype || 'application/octet-stream',
      originalName: file.originalname,
      folder: `${folderPrefix}media/public/${scope}`,
      metadata: {
        scope,
        source: 'dashboard-upload',
        villageId,
      },
    });

    res.json({
      success: true,
      data: {
        filename: uploaded.fileName,
        mime_type: file.mimetype,
        size: file.size,
        path: uploaded.key,
        url: uploaded.url,
        internal_url: uploaded.internalUrl,
      },
    });
  } catch (error: any) {
    logger.error('Upload media error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Gagal upload media' });
  }
}
