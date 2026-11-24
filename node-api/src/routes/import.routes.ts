import { Router } from 'express';
import { importController } from '../controllers/import.controller';
import { requireAuth, requireAnyRole } from '../middleware/rbac';
import { csvUploadMiddleware } from '../middleware/upload';

export const importRouter = Router();

// Preview CSV and detect duplicates (Admin and Recruiter only)
importRouter.post(
  '/csv/preview',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  csvUploadMiddleware.fields([
    { name: 'file', maxCount: 1 },
    { name: 'csv', maxCount: 1 },
  ]),
  (req, res, next) => {
    if (!req.file && req.files) {
      const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
      req.file = filesObj['file']?.[0] || filesObj['csv']?.[0];
    }
    importController.previewCsv(req, res, next);
  }
);

importRouter.post(
  '/preview',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  csvUploadMiddleware.fields([
    { name: 'file', maxCount: 1 },
    { name: 'csv', maxCount: 1 },
  ]),
  (req, res, next) => {
    if (!req.file && req.files) {
      const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
      req.file = filesObj['file']?.[0] || filesObj['csv']?.[0];
    }
    importController.previewCsv(req, res, next);
  }
);

// Upload CSV file (Admin and Recruiter only)
importRouter.post(
  '/upload',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  csvUploadMiddleware.fields([
    { name: 'file', maxCount: 1 },
    { name: 'csv', maxCount: 1 },
  ]),
  (req, res, next) => {
    if (!req.file && req.files) {
      const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
      req.file = filesObj['file']?.[0] || filesObj['csv']?.[0];
    }
    importController.uploadCsv(req, res, next);
  }
);

// Confirm import batch (Admin and Recruiter only)
importRouter.post(
  '/:importId/confirm',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  (req, res, next) => {
    importController.confirmImport(req, res, next);
  }
);

importRouter.post(
  '/confirm',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  (req, res, next) => {
    importController.confirmImport(req, res, next);
  }
);

// Execute batch ingestion (Admin and Recruiter only)
importRouter.post(
  '/:batchId/execute',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  (req, res, next) => {
    importController.executeBatch(req, res, next);
  }
);

// Get single batch status
importRouter.get(
  '/:batchId',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  (req, res, next) => {
    importController.getBatchById(req, res, next);
  }
);

// List import batches
importRouter.get(
  '/',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  (req, res, next) => {
    importController.listBatches(req, res, next);
  }
);
