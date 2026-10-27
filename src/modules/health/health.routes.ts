import { Router } from 'express';
import type { AppConfig } from '../../config/env.js';
import { pingDatabase } from '../../platform/db/pool.js';

export function createHealthRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      checks: {
        process: 'up'
      }
    });
  });

  router.get('/ready', async (_req, res) => {
    try {
      await pingDatabase(config.database);
      res.status(200).json({
        status: 'ok',
        checks: {
          process: 'up',
          database: 'up'
        }
      });
    } catch {
      res.status(503).json({
        status: 'unavailable',
        checks: {
          process: 'up',
          database: 'down'
        }
      });
    }
  });

  return router;
}
