import { Request, Response, NextFunction } from 'express';
import { healthService } from '../services/health.service';

export class HealthController {
  public getHealth = (_req: Request, res: Response, _next: NextFunction): void => {
    const health = healthService.getHealth();
    res.status(200).json({
      success: true,
      data: health,
    });
  };

  public getDatabaseHealth = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const dbHealth = await healthService.getDatabaseHealth();
      const statusCode = dbHealth.status === 'connected' ? 200 : 503;
      res.status(statusCode).json({
        success: dbHealth.status === 'connected',
        data: dbHealth,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const healthController = new HealthController();
