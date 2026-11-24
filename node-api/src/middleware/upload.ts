import multer from 'multer';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '../utils/errors';
import { env } from '../config/env';

const maxResumeBytes = env.MAX_RESUME_SIZE_MB * 1024 * 1024;
const maxCsvBytes = (env.MAX_CSV_SIZE_MB || 100) * 1024 * 1024;

// Store uploads in memory first so magic bytes can be verified before saving to disk
const storage = multer.memoryStorage();

const allowedMimeTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // fallback for some browsers
];

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.pdf' && ext !== '.docx') {
    return cb(new BadRequestError('Unsupported file extension. Only PDF and DOCX files are allowed.'));
  }

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new BadRequestError(`Unsupported MIME type: ${file.mimetype}`));
  }

  cb(null, true);
};

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: maxResumeBytes,
    files: 1,
  },
  fileFilter,
});

const allowedCsvMimeTypes = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'text/plain',
];

const csvFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.csv') {
    return cb(new BadRequestError('Unsupported file extension. Only CSV files are allowed.'));
  }

  if (!allowedCsvMimeTypes.includes(file.mimetype)) {
    return cb(new BadRequestError(`Unsupported MIME type: ${file.mimetype}`));
  }

  cb(null, true);
};

export const csvUploadMiddleware = multer({
  storage,
  limits: {
    fileSize: maxCsvBytes,
    files: 1,
  },
  fileFilter: csvFileFilter,
});

/**
 * Validates magic-byte signatures for uploaded file buffer.
 * PDF magic bytes: %PDF- (0x25 0x50 0x44 0x46 0x2D)
 * DOCX magic bytes: PK\x03\x04 (0x50 0x4B 0x03 0x04)
 */
export function validateMagicBytes(file: Express.Multer.File): void {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = file.buffer;

  if (!buffer || buffer.length < 4) {
    throw new BadRequestError('Invalid or empty file content');
  }

  if (ext === '.pdf') {
    const isPdf =
      buffer[0] === 0x25 && // %
      buffer[1] === 0x50 && // P
      buffer[2] === 0x44 && // D
      buffer[3] === 0x46; // F
    if (!isPdf) {
      throw new BadRequestError('File content signature does not match a valid PDF document');
    }
  } else if (ext === '.docx') {
    const isDocx =
      buffer[0] === 0x50 && // P
      buffer[1] === 0x4b && // K
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;
    if (!isDocx) {
      throw new BadRequestError('File content signature does not match a valid DOCX document');
    }
  } else {
    throw new BadRequestError('Unsupported document format');
  }
}
