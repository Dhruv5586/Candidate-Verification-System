import { Request, Response, NextFunction } from 'express';
import { verificationService } from '../services/verification.service';
import {
  createClaimSchema,
  createVerificationSchema,
  assignReviewerSchema,
  reviewVerificationSchema,
  verificationQuerySchema,
} from '../validators/verification.validator';
import { UnauthorizedError } from '../utils/errors';

export class VerificationController {
  /**
   * POST /api/v1/candidates/:id/claims
   */
  public async addClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = req.params.id as string;
      const validated = createClaimSchema.parse(req.body);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

      const claim = await verificationService.addClaim(
        req.user,
        candidateId,
        validated,
        req.ip,
        userAgent
      );

      res.status(201).json({
        success: true,
        data: claim,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/candidates/:id/claims
   */
  public async getClaims(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = req.params.id as string;

      const claims = await verificationService.getClaims(req.user, candidateId);

      res.status(200).json({
        success: true,
        data: claims,
        meta: { count: claims.length, timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/verifications
   */
  public async createVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const validated = createVerificationSchema.parse(req.body);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

      const verification = await verificationService.createVerification(
        req.user,
        validated,
        req.ip,
        userAgent
      );

      res.status(201).json({
        success: true,
        data: verification,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/verifications
   * Verification review queue.
   */
  public async getQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const query = verificationQuerySchema.parse(req.query);

      const result = await verificationService.getVerificationQueue(req.user, {
        status: query.status,
        priority: query.priority,
        reviewerId: query.reviewer_id,
        candidateId: query.candidate_id,
        page: query.page,
        limit: query.limit,
      });

      const totalPages = Math.ceil(result.total / result.limit) || 1;

      res.status(200).json({
        success: true,
        data: result.verifications,
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
   * PATCH /api/v1/verifications/:id/assign
   * Admin only reassigns reviewer.
   */
  public async assignReviewer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const verificationId = req.params.id as string;
      const validated = assignReviewerSchema.parse(req.body);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

      const updated = await verificationService.assignReviewer(
        req.user,
        verificationId,
        validated.reviewer_id,
        req.ip,
        userAgent
      );

      res.status(200).json({
        success: true,
        data: updated,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/verifications/:id/review
   * Reviewer or Admin submits review decision.
   */
  public async submitReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const verificationId = req.params.id as string;
      const validated = reviewVerificationSchema.parse(req.body);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

      const updated = await verificationService.submitReview(
        req.user,
        verificationId,
        validated,
        req.ip,
        userAgent
      );

      res.status(200).json({
        success: true,
        data: updated,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/candidates/:candidateId/verifications
   * Initiate automated candidate verification workflow.
   */
  public async initiateCandidateVerification(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = (req.params.candidateId || req.params.id) as string;
      const priority = req.body?.priority || 'normal';
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

      const result = await verificationService.initiateCandidateVerification(
        req.user,
        candidateId,
        priority,
        req.ip,
        userAgent
      );

      res.status(201).json({
        success: true,
        data: {
          id: result.verification.id,
          candidate_id: result.verification.candidate_id,
          status: result.verification.status,
          priority: result.verification.priority,
          total_issues: result.totalIssues,
          issues: result.issues.map((i) => ({
            id: i.id,
            severity: i.severity,
            issue_type: i.issue_type,
            description: i.description,
            status: i.status,
          })),
          created_at: result.verification.created_at,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/candidates/:candidateId/verifications
   * List verifications for candidate.
   */
  public async getCandidateVerifications(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const candidateId = (req.params.candidateId || req.params.id) as string;

      const verifications = await verificationService.getCandidateVerifications(req.user, candidateId);

      res.status(200).json({
        success: true,
        data: verifications,
        meta: { total: verifications.length, timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/verifications/:verificationId
   * Retrieve verification details.
   */
  public async getVerificationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const verificationId = (req.params.verificationId || req.params.id) as string;

      const verification = await verificationService.getVerificationById(req.user, verificationId);

      res.status(200).json({
        success: true,
        data: verification,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/verifications/:verificationId/issues
   * List validation issues for a verification task.
   */
  public async getVerificationIssues(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const verificationId = (req.params.verificationId || req.params.id) as string;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const result = await verificationService.getVerificationIssues(req.user, verificationId, {
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        data: result.issues,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit) || 1,
        },
        meta: {
          total: result.total,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const verificationController = new VerificationController();
