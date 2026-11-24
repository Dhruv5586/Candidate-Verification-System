import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from current directory or parent directory
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
      message: 'PORT must be an integer between 1 and 65535',
    }),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z
    .string()
    .url({ message: 'DATABASE_URL must be a valid PostgreSQL connection URL' })
    .refine((url) => url.startsWith('postgres://') || url.startsWith('postgresql://'), {
      message: 'DATABASE_URL must begin with postgres:// or postgresql://',
    }),
  GO_AUTH_INTERNAL_URL: z
    .string()
    .url({ message: 'GO_AUTH_INTERNAL_URL must be a valid HTTP URL' })
    .default('http://localhost:8080'),
  INTERNAL_SERVICE_SECRET: z
    .string()
    .min(16, { message: 'INTERNAL_SERVICE_SECRET must be at least 16 characters long' }),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:8080,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:8080,http://127.0.0.1:5173')
    .transform((val) => val.split(',').map((origin) => origin.trim())),
  RESUME_STORAGE_PATH: z
    .string()
    .default('D:/CandidateVerificationSystem/private-storage/resumes'),
  MAX_RESUME_SIZE_MB: z
    .string()
    .default('5')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val <= 50, {
      message: 'MAX_RESUME_SIZE_MB must be between 1 and 50',
    }),
  MAX_CSV_SIZE_MB: z
    .string()
    .default('100')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val <= 500, {
      message: 'MAX_CSV_SIZE_MB must be between 1 and 500',
    }),
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const formattedErrors = error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
    console.error(`\x1b[31m[FATAL] Configuration validation error:\n${formattedErrors}\x1b[0m`);
  } else {
    console.error('\x1b[31m[FATAL] Unexpected error during configuration parsing:\x1b[0m', error);
  }
  // If running in test with custom process.env, do not exit immediately if caught
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
  // Fallback for tests if needed
  parsedEnv = {} as Env;
}

export const env = parsedEnv;
export { envSchema };
