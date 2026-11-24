import { Router } from 'express';
import { healthRoutes } from './health.routes';
import { docsRoutes } from './docs.routes';
import { authRouter } from './auth.routes';
import { rbacRouter } from './rbac.routes';
import { candidateRouter } from './candidate.routes';
import { resumeRouter } from './resume.routes';
import { importRouter } from './import.routes';
import { verificationRouter } from './verification.routes';
import { reviewerRouter } from './reviewer.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/docs', docsRoutes);
apiRouter.use('/auth', authRouter);
apiRouter.use('/rbac', rbacRouter);
apiRouter.use('/candidates', candidateRouter);
apiRouter.use('/resumes', resumeRouter);
apiRouter.use('/documents', resumeRouter);
apiRouter.use('/imports', importRouter);
apiRouter.use('/verifications', verificationRouter);
apiRouter.use('/reviewer', reviewerRouter);
