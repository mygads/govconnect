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
      folder: `media/public/${scope}`,
      metadata: {
        scope,
        source: 'dashboard-upload',
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
