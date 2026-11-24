import { z } from 'zod';

export const createClaimSchema = z.object({
  claim_type: z.enum([
    'education',
    'employment',
    'identity',
    'criminal_check',
    'certification',
    'reference',
  ]),
  organization_name: z
    .string({ required_error: 'Organization name is required' })
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(255),
  title_or_degree: z.string().trim().max(255).optional().nullable(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
});

export const createVerificationSchema = z.object({
  candidate_id: z.string().uuid('Invalid candidate ID format'),
  claim_id: z.string().uuid('Invalid claim ID format').optional().nullable(),
  reviewer_id: z.string().uuid('Invalid reviewer ID format').optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const assignReviewerSchema = z
  .object({
    reviewer_id: z.string().uuid('Invalid reviewer ID format').optional(),
    reviewerId: z.string().uuid('Invalid reviewer ID format').optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    notes: z.string().optional(),
  })
  .refine((data) => Boolean(data.reviewer_id || data.reviewerId), {
    message: 'Reviewer ID is required',
  })
  .transform((data) => ({
    reviewer_id: (data.reviewer_id || data.reviewerId)!,
    priority: data.priority,
    notes: data.notes,
  }));

export const reviewVerificationSchema = z.object({
  status: z.enum(['passed', 'failed', 'requires_review'], {
    required_error: 'Status must be passed, failed, or requires_review',
  }),
  notes: z
    .string({ required_error: 'Review notes are required' })
    .trim()
    .min(5, 'Review notes must be at least 5 characters long')
    .max(2000),
});

export const verificationQuerySchema = z.object({
  status: z.enum(['pending', 'passed', 'failed', 'requires_review']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  reviewer_id: z.string().uuid().optional(),
  candidate_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
