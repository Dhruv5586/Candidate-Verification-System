import { app } from './app';
import { env } from './config/env';
import { closeDatabasePool, checkDatabaseConnection } from './config/database';
import { logger } from './utils/logger';

const server = app.listen(env.PORT, async () => {
  logger.info(`Candidate Verification Node.js API started on port ${env.PORT} [${env.NODE_ENV}]`);
  logger.info(`Health check: http://localhost:${env.PORT}/api/v1/health`);
  logger.info(`Database health: http://localhost:${env.PORT}/api/v1/health/database`);
  logger.info(`API Documentation: http://localhost:${env.PORT}/api/v1/docs`);

  // Verify DB connection at startup
  const isDbConnected = await checkDatabaseConnection();
  if (isDbConnected) {
    logger.info('Successfully connected to PostgreSQL (candidate_verification)');
  } else {
    logger.warn('Initial PostgreSQL connection check failed. Check database credentials and network.');
  }
});

// Graceful shutdown handling
let isShuttingDown = false;

async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // 1. Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error closing HTTP server');
    } else {
      logger.info('HTTP server closed successfully.');
    }

    // 2. Close PostgreSQL connection pool
    logger.info('Draining database connection pool...');
    await closeDatabasePool();
    logger.info('Database pool closed. Shutdown complete.');

    process.exit(0);
  });

  // Force close after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcefully terminating process.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled Promise Rejection detected');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught Exception detected. Shutting down...');
  process.exit(1);
});

export { server };
