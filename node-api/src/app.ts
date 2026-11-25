import express, { Application } from 'express';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { requestLogger } from './middleware/requestLogger';
import { notFoundHandler } from './middleware/notFoundHandler';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp(): Application {
  const app = express();

  // 1. Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
    })
  );

  // 2. Cross-Origin Resource Sharing (CORS)
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (env.CORS_ALLOWED_ORIGINS.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Secret'],
    })
  );

  // 3. Body & Cookie Parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // 4. Structured HTTP Request Logging
  if (env.NODE_ENV !== 'test') {
    app.use(requestLogger);
  }

  // 5. Clean URL Middleware: Redirect any request ending in .html to its extensionless clean URL
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.endsWith('.html')) {
      const cleanPath = req.path === '/index.html' ? '/' : req.path.slice(0, -5);
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return res.redirect(301, cleanPath + query);
    }
    next();
  });

  // 6. Static Frontend Files with automatic .html extension resolution
  const frontendPath = path.resolve(__dirname, '../../frontend');
  app.use(express.static(frontendPath, { extensions: ['html'], index: false }));

  // 7. API Routes
  app.use('/api/v1', apiRouter);

  // Root route: serve frontend index.html cleanly at http://localhost:3000/
  app.get('/', (_req, res) => {
    const indexPath = path.join(frontendPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.redirect('/api/v1/docs');
    }
  });

  // Documentation route: serve frontend docs.html
  app.get(['/docs', '/documentation'], (_req, res) => {
    const docsPath = path.join(frontendPath, 'docs.html');
    if (fs.existsSync(docsPath)) {
      res.sendFile(docsPath);
    } else {
      res.redirect('/api/v1/docs');
    }
  });

  // 6. 404 Route Not Found Handler
  app.use(notFoundHandler);

  // 7. Centralized Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
