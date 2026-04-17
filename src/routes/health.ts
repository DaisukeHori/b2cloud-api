import { Router } from 'express';

const router = Router();

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: ヘルスチェック
 *     tags: [System]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

export default router;
