import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class StorageService {
  private readonly storageDir: string;

  constructor(storageDir: string = env.RESUME_STORAGE_PATH) {
    this.storageDir = path.resolve(storageDir);
    this.ensureStorageDir();
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
      logger.info({ dir: this.storageDir }, 'Private storage directory initialized');
    }
  }

  /**
   * Save file buffer with randomized UUID filename.
   * Path traversal safe. Returns relative storage key and SHA-256 hash.
   */
  public async saveFile(
    buffer: Buffer,
    originalName: string
  ): Promise<{ storageKey: string; sha256Hash: string; fileSizeBytes: number }> {
    const ext = path.extname(originalName).toLowerCase();
    const safeExt = ext === '.pdf' || ext === '.docx' ? ext : '.bin';
    const uuid = crypto.randomUUID();
    const storageKey = `${uuid}${safeExt}`;
    const absolutePath = this.resolvePath(storageKey);

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Exclusive write flag 'wx' prevents clobbering existing files
    await fs.promises.writeFile(absolutePath, buffer, { flag: 'wx', mode: 0o600 });

    return {
      storageKey,
      sha256Hash: hash,
      fileSizeBytes: buffer.length,
    };
  }

  /**
   * Safely resolve absolute path ensuring no directory traversal escapes.
   */
  public resolvePath(storageKey: string): string {
    const sanitizedKey = path.basename(storageKey);
    const resolved = path.resolve(this.storageDir, sanitizedKey);

    if (!resolved.startsWith(this.storageDir)) {
      throw new BadRequestError('Security error: invalid storage key traversal detected');
    }

    return resolved;
  }

  /**
   * Read file buffer.
   */
  public async readFile(storageKey: string): Promise<Buffer> {
    const filePath = this.resolvePath(storageKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundError('Stored document file not found on disk');
    }
    return fs.promises.readFile(filePath);
  }

  /**
   * Create readable stream for file download.
   */
  public createReadStream(storageKey: string): fs.ReadStream {
    const filePath = this.resolvePath(storageKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundError('Stored document file not found on disk');
    }
    return fs.createReadStream(filePath);
  }

  /**
   * Safely delete file (e.g. when database transaction rolls back).
   */
  public async cleanupFile(storageKey: string): Promise<void> {
    try {
      const filePath = this.resolvePath(storageKey);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        logger.info({ storageKey }, 'Orphaned storage file deleted successfully');
      }
    } catch (err: any) {
      logger.error({ err: err.message, storageKey }, 'Failed to delete storage file during cleanup');
    }
  }
}

export const storageService = new StorageService();
