import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { commercialInterestRateLimiter, publicCatalogRateLimiter } from '../middleware/rateLimit';
import { createCommercialInterest, getPublicCommercialOffer } from '../services/commercialOfferStore';

export function createCommercialOfferRouter(): Router {
  const router = Router();

  router.get('/api/public/oferta', publicCatalogRateLimiter, asyncHandler(async (_req, res) => {
    const plans = await getPublicCommercialOffer();
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    res.json({ plans });
  }));

  router.post('/api/public/oferta/interesse', commercialInterestRateLimiter, asyncHandler(async (req, res) => {
    const interest = await createCommercialInterest(req.body);
    res.status(201).json({ interest: { id: interest.id, createdAt: interest.created_at } });
  }));

  return router;
}
