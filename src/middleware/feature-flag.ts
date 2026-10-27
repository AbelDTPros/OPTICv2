import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { FeatureFlagKey } from '../modules/feature-flags/domain/catalog.js';
import type { FeatureFlagService } from '../modules/feature-flags/service/feature-flag.service.js';

export function requireFeatureFlag(
  features: FeatureFlagService,
  key: FeatureFlagKey
): RequestHandler {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await features.assertEnabled(key);
      next();
    } catch (error) {
      next(error);
    }
  };
}
