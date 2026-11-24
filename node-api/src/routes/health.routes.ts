import { Router } from 'express';
import { healthController } from '../controllers/health.controller';

const router = Router();

// GET /api/v1/health
router.get('/', healthController.getHealth);

// GET /api/v1/health/database
router.get('/database', healthController.getDatabaseHealth);

export const healthRoutes = router;
