import { z } from 'zod';

export const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{6,20}$/;

export const createCandidateSchema = z
  .object({
    full_name: z.string().trim().min(2).max(255).optional(),
    fullName: z.string().trim().min(2).max(255).optional(),
    firstName: z.string().trim().max(255).optional(),
    lastName: z.string().trim().max(255).optional(),
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .email({ message: 'Invalid email address format' })
      .max(255)
      .transform((val) => val.toLowerCase()),
    phone: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((val) => (val && val.length > 0 ? val : null))
      .refine((val) => !val || phoneRegex.test(val), { message: 'Invalid phone number format' }),
    location: z.string().trim().max(255).optional().nullable(),
    current_job_title: z.string().trim().max(255).optional().nullable(),
    currentJobTitle: z.string().trim().max(255).optional().nullable(),
  })
  .refine(
    (data) => !!(data.full_name || data.fullName || (data.firstName && data.firstName.trim())),
    {
      message: 'Full name is required',
      path: ['fullName'],
    }
  )
  .transform((data) => {
    const derivedFullName =
      data.fullName ||
      data.full_name ||
      [data.firstName, data.lastName].filter(Boolean).join(' ').trim();
    return {
      full_name: derivedFullName,
      email: data.email,
      phone: data.phone,
      location: data.location,
      current_job_title: data.currentJobTitle || data.current_job_title,
    };
  });

export const updateCandidateSchema = z
  .object({
    full_name: z.string().trim().min(2).max(255).optional(),
    fullName: z.string().trim().min(2).max(255).optional(),
    email: z
      .string()
      .trim()
      .email({ message: 'Invalid email address format' })
      .max(255)
      .transform((val) => val.toLowerCase())
      .optional(),
    phone: z.string().trim().regex(phoneRegex, { message: 'Invalid phone number format' }).optional().nullable(),
    location: z.string().trim().max(255).optional().nullable(),
    current_job_title: z.string().trim().max(255).optional().nullable(),
    currentJobTitle: z.string().trim().max(255).optional().nullable(),
    status: z.enum(['pending', 'in_progress', 'verified', 'flagged', 'rejected']).optional(),
  })
  .transform((data) => ({
    full_name: data.fullName || data.full_name,
    email: data.email,
    phone: data.phone,
    location: data.location,
    current_job_title: data.currentJobTitle || data.current_job_title,
    status: data.status,
  }));

export const candidateQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(['pending', 'in_progress', 'verified', 'flagged', 'rejected']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
