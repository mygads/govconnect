import type { Request, Response } from 'express';
import logger from '../utils/logger';

const MEDIA_INTERNAL_URL = process.env.MEDIA_INTERNAL_URL || 'http://channel-service:3001/uploads';
const MEDIA_PUBLIC_URL = process.env.MEDIA_PUBLIC_URL || 'http://localhost:3001/uploads';

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
    const scope = getScope((req.query as any)?.scope);

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ success: false, error: 'File tidak ditemukan' });
      return;
    }

    const relativePath = `public/${scope}/${file.filename}`;
    const internalUrl = `${MEDIA_INTERNAL_URL.replace(/\/$/, '')}/${relativePath}`;
    const publicUrl = `${MEDIA_PUBLIC_URL.replace(/\/$/, '')}/${relativePath}`;

    res.json({
      success: true,
      data: {
        filename: file.filename,
        mime_type: file.mimetype,
        size: file.size,
        path: relativePath,
        url: publicUrl,
        internal_url: internalUrl,
      },
    });
  } catch (error: any) {
    logger.error('Upload media error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Gagal upload media' });
  }
}
