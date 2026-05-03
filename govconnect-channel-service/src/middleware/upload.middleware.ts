import multer from 'multer';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';

function isAllowedMimeType(mimeType: string): boolean {
  const allowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/webm',
    'video/mp4',
    'video/webm',
  ]);
  return allowed.has(mimeType);
}

export const uploadPublicMedia = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
    if (!isAllowedMimeType(file.mimetype)) {
      cb(new Error('Tipe file tidak didukung. Gunakan gambar, dokumen, audio, atau video WhatsApp.'));
      return;
    }
    cb(null, true);
  },
});
