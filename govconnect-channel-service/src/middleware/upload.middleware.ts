import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';
import { getQuery } from '../utils/http';

const MEDIA_STORAGE_PATH = process.env.MEDIA_STORAGE_PATH || '/app/uploads';

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getScope(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return 'public';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function isAllowedMimeType(mimeType: string): boolean {
  const allowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);
  return allowed.has(mimeType);
}

const storage = multer.diskStorage({
  destination(req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) {
    const scope = getScope(getQuery(req, 'scope'));
    const dir = path.join(MEDIA_STORAGE_PATH, 'public', scope);
    ensureDir(dir);
    cb(null, dir);
  },
  filename(_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) {
    const original = file.originalname || '';
    const ext = path.extname(original).toLowerCase();
    const safeExt = ext && ext.length <= 10 ? ext : '';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

export const uploadPublicMedia = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
    if (!isAllowedMimeType(file.mimetype)) {
      cb(new Error('Tipe file tidak didukung. Gunakan PDF/JPG/PNG/DOC/DOCX.'));
      return;
    }
    cb(null, true);
  },
});
