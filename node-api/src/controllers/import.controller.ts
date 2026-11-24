import { Request, Response, NextFunction } from 'express';
import { csvIngestionService } from '../services/csvIngestion.service';
import { importQuerySchema, confirmImportSchema } from '../validators/import.validator';
import { UnauthorizedError, BadRequestError } from '../utils/errors';

export class ImportController {
  /**
   * POST /api/v1/imports/upload
   * Upload CSV file, store securely, and return row preview and header detection.
   */
  public async uploadCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      if (!req.file) {
        throw new BadRequestError('No CSV file uploaded. Please upload a file in the "file" field.');
      }

      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
      const preview = await csvIngestionService.uploadAndPreview(
        req.user,
        req.file,
        req.ip,
        userAgent
      );

      res.status(201).json({
        success: true,
        data: preview,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/imports/:batchId/execute
   * Execute validation and chunked candidate ingestion for an uploaded batch.
   */
  public async executeBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const batchId = req.params.batchId as string;
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

      const result = await csvIngestionService.executeBatch(
        req.user,
        batchId,
        req.ip,
        userAgent
      );

      res.status(200).json({
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/imports/:batchId
   * Retrieve batch ingestion status and summary.
   */
  public async getBatchById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const batchId = req.params.batchId as string;

      const batch = await csvIngestionService.getBatchById(req.user, batchId);

      res.status(200).json({
        success: true,
        data: batch,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/imports
   * List import batches with pagination.
   */
  public async listBatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const query = importQuerySchema.parse(req.query);

      const result = await csvIngestionService.listBatches(req.user, query);
      const totalPages = Math.ceil(result.total / result.limit) || 1;

      res.status(200).json({
        success: true,
        data: result.batches,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages,
        },
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/imports/csv/preview
   * Preview CSV file with comprehensive duplicate detection across CSV and PostgreSQL.
   */
  public async previewCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const batchId = (req.body?.batchId || req.body?.batch_id || req.query?.batchId || req.query?.batch_id) as
        | string
        | undefined;
      const csvContent = (req.body?.csvContent || req.body?.csv) as string | undefined;

      const result = await csvIngestionService.previewAndDetectDuplicates(req.user, {
        file: req.file,
        batchId,
        csvContent,
      });

      res.status(200).json({
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/imports/:importId/confirm
   * Confirm and execute import of eligible candidate records into PostgreSQL.
   */
  public async confirmImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const importId = (req.params.importId || req.params.batchId || req.body?.importId || req.body?.batchId || req.body?.confirmationToken) as string;
      if (!importId) {
        throw new BadRequestError('Import ID is required');
      }

      const body = confirmImportSchema.parse(req.body);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

      const result = await csvIngestionService.confirmImport(
        req.user,
        importId,
        body,
        req.ip,
        userAgent
      );

      res.status(200).json({
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const importController = new ImportController();
