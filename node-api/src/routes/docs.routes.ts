import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from '../docs/swagger';

const router = Router();

// Swagger JSON definition endpoint
router.get('/json', (_req, res) => {
  res.json(swaggerDocument);
});

// Swagger UI interactive documentation
router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

export const docsRoutes = router;
