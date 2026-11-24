import { Request, Response, NextFunction } from 'express';
import { candidateService } from '../services/candidate.service';
import { storageService } from '../services/storage.service';
import { documentRepository } from '../repositories/document.repository';
import { extractionRepository } from '../repositories/extraction.repository';
import { validationIssueRepository } from '../repositories/validationIssue.repository';
import { extractionService } from '../services/extraction.service';
import { resumeValidationService } from '../services/resumeValidation.service';
import { resourceAuthService } from '../services/resourceAuth.service';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { validateMagicBytes } from '../middleware/upload';
import {
  createCandidateSchema,
  updateCandidateSchema,
  candidateQuerySchema,
} from '../validators/candidate.validator';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from '../utils/errors';
import crypto from 'crypto';

export class CandidateController {
  /**
   * POST /api/v1/candidates
   */
  public async createCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const validated = createCandidateSchema.parse(req.body);
      const candidate = await candidateService.createCandidate(
        req.user,
        validated,
        req.ip,
        req.headers['user-agent']
      );

      res.status(201).json({
        success: true,
        data: candidate,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/candidates
   */
  public async getCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const validatedQuery = candidateQuerySchema.parse(req.query);
      const result = await candidateService.listCandidates(req.user, validatedQuery);

      const totalPages = Math.ceil(result.total / result.limit) || 1;

      res.status(200).json({
        success: true,
        data: result.candidates,
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
   * GET /api/v1/candidates/stats
   */
  public async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const stats = await candidateService.getDashboardStats();
      res.status(200).json({
        success: true,
        data: stats,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/candidates/:id
   */
  public async getCandidateById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = req.params.id as string;
      const candidate = await candidateService.getCandidateById(req.user, candidateId);
      const documents = await documentRepository.findByCandidateId(candidateId);

      res.status(200).json({
        success: true,
        data: {
          ...candidate,
          documentsCount: documents.length,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/candidates/:id
   */
  public async updateCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = req.params.id as string;
      const validated = updateCandidateSchema.parse(req.body);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
      const candidate = await candidateService.updateCandidate(
        req.user,
        candidateId,
        validated,
        req.ip,
        userAgent
      );

      res.status(200).json({
        success: true,
        data: candidate,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/candidates/:id
   */
  public async deleteCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = req.params.id as string;
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
      await candidateService.deleteCandidate(
        req.user,
        candidateId,
        req.ip,
        userAgent
      );

      res.status(200).json({
        success: true,
        message: 'Candidate soft-deleted successfully',
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/candidates/:id/resumes
   * Upload resume document, extract text, and run automated rule-based validation checks.
   */
  public async uploadResume(req: Request, res: Response, next: NextFunction): Promise<void> {
    let savedStorageKey: string | undefined;
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = req.params.id as string;

      // 1. Verify candidate existence & ownership
      const candidate = await candidateService.getCandidateById(req.user, candidateId);

      // 2. Validate file presence
      if (!req.file || !req.file.buffer) {
        throw new BadRequestError('No resume file uploaded. Please upload a file in the "resume" field.');
      }

      // 3. Inspect magic bytes for content spoofing
      validateMagicBytes(req.file);

      // 4. Calculate SHA-256 checksum and check duplicates
      const checksumSha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const duplicate = await documentRepository.findByChecksum(candidateId, checksumSha256);
      if (duplicate) {
        throw new ConflictError('A duplicate resume with identical content has already been uploaded for this candidate');
      }

      // 5. Store file privately on disk with random UUID filename
      const saved = await storageService.saveFile(req.file.buffer, req.file.originalname);
      savedStorageKey = saved.storageKey;

      // 6. Record document metadata in PostgreSQL
      const document = await documentRepository.create({
        candidateId,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSizeBytes: saved.fileSizeBytes,
        storageKey: saved.storageKey,
        checksumSha256: saved.sha256Hash,
        documentType: 'resume',
        uploadStatus: 'completed',
        uploadedBy: req.user.id,
      });

      // 7. Extract text safely
      const extraction = await extractionService.extractText(req.file.buffer, req.file.originalname);
      const extractionRecord = await extractionRepository.create({
        documentId: document.id,
        extractedText: extraction.text,
        extractedData: extraction.data,
        extractionStatus: extraction.status,
        parserName: extraction.parserName,
        parserVersion: extraction.parserVersion,
      });

      // 8. Run rule-based resume validation checks
      const validationIssues = await resumeValidationService.validateResume(
        candidate,
        document.id,
        extraction.text
      );

      // 9. Audit log entry
      await auditLogRepository.logEvent({
        userId: req.user.id,
        action: 'RESUME_UPLOADED',
        entityType: 'document',
        entityId: document.id,
        newValues: {
          candidateId,
          fileName: document.file_name,
          checksumSha256: document.checksum_sha256,
          fileSizeBytes: document.file_size_bytes,
          extractionStatus: extraction.status,
          issuesCount: validationIssues.length,
        },
        ipAddress: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      });

      res.status(201).json({
        success: true,
        data: {
          document: {
            id: document.id,
            candidateId: document.candidate_id,
            fileName: document.file_name,
            fileType: document.file_type,
            fileSizeBytes: document.file_size_bytes,
            checksumSha256: document.checksum_sha256,
            documentType: document.document_type,
            uploadStatus: document.upload_status,
            createdAt: document.created_at,
          },
          extraction: {
            id: extractionRecord.id,
            status: extractionRecord.extraction_status,
            parserName: extractionRecord.parser_name,
            textPreview: extractionRecord.extracted_text.slice(0, 300),
          },
          validationIssues: validationIssues.map((issue) => ({
            id: issue.id,
            severity: issue.severity,
            issueType: issue.issue_type,
            description: issue.description,
            status: issue.status,
          })),
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      // If error occurs after writing file to disk, clean up orphaned file
      if (savedStorageKey) {
        await storageService.cleanupFile(savedStorageKey);
      }
      next(err);
    }
  }

  /**
   * GET /api/v1/candidates/:id/resumes
   */
  public async getCandidateResumes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = req.params.id as string;

      // Check candidate access
      await candidateService.getCandidateById(req.user, candidateId);

      const documents = await documentRepository.findByCandidateId(candidateId);

      const documentsWithExtractions = await Promise.all(
        documents.map(async (doc) => {
          const extraction = await extractionRepository.findByDocumentId(doc.id);
          return {
            id: doc.id,
            candidateId: doc.candidate_id,
            fileName: doc.file_name,
            fileType: doc.file_type,
            fileSizeBytes: doc.file_size_bytes,
            checksumSha256: doc.checksum_sha256,
            documentType: doc.document_type,
            uploadStatus: doc.upload_status,
            createdAt: doc.created_at,
            extractedText: extraction?.extracted_text || null,
            extracted_text: extraction?.extracted_text || null,
            extractionStatus: extraction?.extraction_status || null,
          };
        })
      );

      res.status(200).json({
        success: true,
        data: documentsWithExtractions,
        meta: { count: documents.length, timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/resumes/:documentId
   */
  public async getResumeById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const documentId = req.params.documentId as string;

      const document = await documentRepository.findById(documentId);
      if (!document) {
        throw new NotFoundError(`Document not found: ${documentId}`);
      }

      // Authorize access via candidate ownership
      await candidateService.getCandidateById(req.user, document.candidate_id);

      const extraction = await extractionRepository.findByDocumentId(documentId);
      const issues = await validationIssueRepository.findByDocumentId(documentId);

      res.status(200).json({
        success: true,
        data: {
          document: {
            id: document.id,
            candidateId: document.candidate_id,
            fileName: document.file_name,
            fileType: document.file_type,
            fileSizeBytes: document.file_size_bytes,
            checksumSha256: document.checksum_sha256,
            documentType: document.document_type,
            uploadStatus: document.upload_status,
            createdAt: document.created_at,
          },
          extraction: extraction
            ? {
              id: extraction.id,
              status: extraction.extraction_status,
              parserName: extraction.parser_name,
              parserVersion: extraction.parser_version,
              extractedText: extraction.extracted_text,
              extractedData: extraction.extracted_data,
            }
            : null,
          validationIssues: issues.map((i) => ({
            id: i.id,
            severity: i.severity,
            issueType: i.issue_type,
            description: i.description,
            status: i.status,
          })),
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/resumes/:documentId/download
   * Securely streams resume file with safe Content-Disposition headers.
   */
  public async downloadResume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const documentId = req.params.documentId as string;

      const document = await documentRepository.findById(documentId);
      if (!document) {
        throw new NotFoundError(`Document not found: ${documentId}`);
      }

      // Enforce candidate access authorization
      await candidateService.getCandidateById(req.user, document.candidate_id);

      // Sanitize filename to prevent header injection
      const sanitizedName = document.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');

      res.setHeader('Content-Type', document.file_type);
      res.setHeader('Content-Length', document.file_size_bytes.toString());
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedName}"`);

      // Audit download action
      await auditLogRepository.logEvent({
        userId: req.user.id,
        action: 'RESUME_DOWNLOADED',
        entityType: 'document',
        entityId: document.id,
        newValues: { candidateId: document.candidate_id, fileName: sanitizedName },
        ipAddress: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      });

      const stream = storageService.createReadStream(document.storage_key);
      stream.on('error', (streamErr) => {
        next(streamErr);
      });
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
}

export const candidateController = new CandidateController();
