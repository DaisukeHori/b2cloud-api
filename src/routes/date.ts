/**
 * Date API ルーター（B2 セッション不要、API キーのみ）
 *
 * /api/b2/date/search — 配達予定日検索
 * /api/b2/date/shortest — 最短配達スロット取得
 *
 * @see docs/date-feature-design_v2.md §6
 */

import { Router } from 'express';
import { dateSearchSchema, dateShortestSchema } from '../validation';
import { searchDeliveryDate } from '../date';
import { findShortestDeliverySlot } from '../date-shortest';

const router = Router();

/**
 * @openapi
 * /api/b2/date/search:
 *   post:
 *     summary: ヤマト運輸 配達予定日検索
 *     tags: [Date]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     description: |
 *       date.kuronekoyamato.co.jp をスクレイピングし、発地/着地/出荷日から
 *       4商品別の配達予定日と時間帯制約を構造化JSONで返す。B2クラウド認証は不要。
 */
router.post('/search', async (req, res, next) => {
  try {
    const input = dateSearchSchema.parse(req.body);
    const result = await searchDeliveryDate(input);
    res.json(result);
  } catch (e: any) {
    next(e);
  }
});

/**
 * @openapi
 * /api/b2/date/shortest:
 *   post:
 *     summary: 最短配達スロット取得
 *     tags: [Date]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     description: |
 *       B2クラウド発行で使える形式(shipment_date, delivery_date, delivery_time_zone)で
 *       最短スロットを返す。
 */
router.post('/shortest', async (req, res, next) => {
  try {
    const input = dateShortestSchema.parse(req.body);
    const result = await findShortestDeliverySlot(input);
    res.json(result);
  } catch (e: any) {
    next(e);
  }
});

export default router;
