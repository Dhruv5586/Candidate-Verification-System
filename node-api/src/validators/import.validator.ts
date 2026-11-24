import { z } from 'zod';
import { phoneRegex } from './candidate.validator';

export const csvRowSchema = z
  .object({
    id: z.coerce.string().optional().nullable(),
    full_name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(255).optional(),
    fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(255).optional(),
    name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(255).optional(),
    job_applicant_name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(255).optional(),
    category: z.string().trim().max(255).optional().nullable(),
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .min(1, 'Email is required')
      .email('Invalid email address')
      .max(255)
      .transform((val) => val.toLowerCase()),
    phone: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((val) => (val && val.length > 0 ? val : null))
      .refine((val) => !val || phoneRegex.test(val), 'Invalid phone number format'),
    location: z.string().trim().max(255).optional().nullable(),
    ethnicity: z.string().trim().max(255).optional().nullable(),
    current_job_title: z.string().trim().max(255).optional().nullable(),
    currentJobTitle: z.string().trim().max(255).optional().nullable(),
    jobTitle: z.string().trim().max(255).optional().nullable(),
    job_roles: z.string().trim().max(255).optional().nullable(),
  })
  .refine((data) => !!(data.full_name || data.fullName || data.name || data.job_applicant_name || data.id), {
    message: 'Full name is required',
    path: ['full_name'],
  })
  .transform((data) => {
    const fullName = (data.full_name || data.fullName || data.name || data.job_applicant_name || (data.id ? `Candidate #${data.id}` : 'Candidate'))!.trim();
    const loc = data.location || data.ethnicity || null;
    const title = data.current_job_title || data.currentJobTitle || data.jobTitle || data.job_roles || data.category || null;

    return {
      full_name: fullName,
      email: data.email,
      phone: data.phone || null,
      location: loc,
      current_job_title: title,
    };
  });

export const importQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
});

export const confirmImportSchema = z
  .object({
    confirm: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    importId: z.string().optional(),
    batchId: z.string().optional(),
    confirmationToken: z.string().optional(),
  })
  .refine((data) => data.confirm === true || data.confirmed === true, {
    message: "Confirmation flag ('confirm: true' or 'confirmed: true') is required to confirm and execute import",
  })
  .transform(() => ({
    confirm: true as const,
  }));
