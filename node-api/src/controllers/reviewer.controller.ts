import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { verificationService } from '../services/verification.service';
import { UnauthorizedError } from '../utils/errors';
import { VerificationStatus } from '../types/verification.types';

const reviewerDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_INFORMATION'], {
      errorMap: () => ({ message: 'Decision must be one of: APPROVED, REJECTED, NEEDS_INFORMATION' }),
    }),
    comment: z.string().optional(),
    comments: z.string().optional(),
    reason: z.string().optional(),
  })
  .transform((data) => ({
    decision: data.decision,
    comment: data.comment || data.comments || data.reason,
    reason: data.reason || data.comment || data.comments,
  }));

const reviewerQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const clean = val.toLowerCase().trim();
      if (['in_progress', 'in_review', 'needs_information', 'needs_info', 'requires_review'].includes(clean)) {
        return 'requires_review' as VerificationStatus;
      }
      if (['approved', 'passed'].includes(clean)) return 'passed' as VerificationStatus;
      if (['rejected', 'failed'].includes(clean)) return 'failed' as VerificationStatus;
      if (clean === 'pending') return 'pending' as VerificationStatus;
      return undefined;
    }),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export class ReviewerController {
  /**
   * GET /api/v1/reviewer/assignments
   * Return only verifications strictly assigned to the authenticated reviewer.
   */
  public async getAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const query = reviewerQuerySchema.parse(req.query);

      const result = await verificationService.getReviewerAssignments(req.user, {
        status: query.status as VerificationStatus | undefined,
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
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/reviewer/assignments/:verificationId
   * Return candidate info, resume metadata & secure download link, automated verification summary,
   * validation issues, assignment status, and audit review history for the assigned reviewer.
   */
  public async getAssignmentDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const verificationId = (req.params.verificationId || req.params.id) as string;

      const details = await verificationService.getReviewerAssignmentDetails(req.user, verificationId);

      res.status(200).json({
        success: true,
        data: details,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/reviewer/assignments/:verificationId/decision
   * Submit reviewer decision (APPROVED, REJECTED, NEEDS_INFORMATION).
   */
  public async submitDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const verificationId = (req.params.verificationId || req.params.id) as string;
      const validated = reviewerDecisionSchema.parse(req.body);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;

      const updated = await verificationService.submitReviewerDecision(
        req.user,
        verificationId,
        validated,
        req.ip,
        userAgent
      );

      res.status(200).json({
        success: true,
        data: {
          id: updated.id,
          candidate_id: updated.candidate_id,
          reviewer_id: req.user.id,
          decision: validated.decision,
          status: updated.status,
          notes: updated.notes,
          verified_at: updated.verified_at,
          updated_at: updated.updated_at,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const reviewerController = new ReviewerController();
