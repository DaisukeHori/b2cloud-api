/**
 * B2 REST API ルーター
 *
 * api/b2/ の 11 ファイルを統合。
 * ボイラープレート（CORS / API キー / セッション / try-catch）はミドルウェアで処理済み。
 * req.b2session に B2Session が注入済み（session middleware による）。
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  shipmentInputSchema,
  inputToShipment,
  getDefaultShipperFromEnv,
  printTypeSchema,
  outputFormatSchema,
  historySearchSchema,
  reprintSchema,
  deleteSavedSchema,
  setPrinterTypeSchema,
} from '../validation';
import {
  checkShipment,
  saveShipment,
  listSavedShipments,
  searchHistory,
  deleteSavedShipments,
} from '../shipment';
import { createAndPrint, reprintFullFlow, downloadPdf } from '../print';
import { printWithFormat, reprintWithFormat, getSettings, setPrinterType } from '../settings';
import { toBase64 } from '../utils';
import { generateSignedDownloadPath } from '../signed-url';
import { applyAutoShortestBatch, type AutoShortestApplied } from '../auto-shortest';
import type { Shipment, FeedEntry, ServiceType } from '../types';

const router = Router();

// ============================================================
// ユーティリティ
// ============================================================

/** クエリパラメータを string | undefined に正規化 */
function q(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v || undefined;
}

// ============================================================
// POST /api/b2/login — 接続テスト
// ============================================================

/**
 * @openapi
 * /api/b2/login:
 *   post:
 *     summary: 接続テスト
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     responses:
 *       200:
 *         description: 認証成功
 */
router.post('/login', async (req, res) => {
  const session = req.b2session!;
  res.json({
    status: 'ok',
    message: '認証成功（ステートレス方式: セッションは保持されません）',
    customerCode: session.customerCode,
    baseUrl: session.baseUrl,
    loginAt: session.loginAt.toISOString(),
    hasTemplate: session.template.length > 0,
    templateLines: session.template.length,
  });
});

// ============================================================
// POST /api/b2/check — バリデーションのみ
// ============================================================

const checkBodySchema = z.object({
  shipments: z.array(shipmentInputSchema).min(1),
});

/**
 * @openapi
 * /api/b2/check:
 *   post:
 *     summary: バリデーションのみ（保存しない）
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     responses:
 *       200:
 *         description: バリデーション結果
 */
router.post('/check', async (req, res, next) => {
  try {
    const input = checkBodySchema.parse(req.body);
    const session = req.b2session!;
    const defaults = getDefaultShipperFromEnv();

    const results = [];
    for (const s of input.shipments) {
      try {
        const shipment = inputToShipment(s, defaults);
        const entry = await checkShipment(session, shipment);
        results.push({
          valid: true,
          error_flg: entry.shipment?.error_flg,
          tracking_number: entry.shipment?.tracking_number,
          checked_date: entry.shipment?.checked_date,
        });
      } catch (e: any) {
        results.push({
          valid: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    res.json({ results });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// POST /api/b2/save — 保存のみ
// ============================================================

const saveBodySchema = z.object({
  shipments: z.array(shipmentInputSchema).min(1),
});

/**
 * @openapi
 * /api/b2/save:
 *   post:
 *     summary: 伝票を保存のみ（印刷しない）
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     responses:
 *       200:
 *         description: 保存結果
 */
router.post('/save', async (req, res, next) => {
  try {
    const input = saveBodySchema.parse(req.body);
    const session = req.b2session!;
    const defaults = getDefaultShipperFromEnv();

    const saved = [];
    for (const s of input.shipments) {
      const shipment = inputToShipment(s, defaults);
      const checked = await checkShipment(session, shipment);
      const savedEntry = await saveShipment(session, checked);
      saved.push({
        tracking_number: savedEntry.shipment?.tracking_number,
        id: savedEntry.id,
        href: savedEntry.link?.[0]?.___href,
      });
    }

    res.json({ saved });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// POST /api/b2/print — フル E2E（check→保存→印刷→PDF→追跡番号）
// ============================================================

const printBodySchema = z.object({
  shipments: z.array(shipmentInputSchema).min(1),
  print_type: printTypeSchema.optional(),
  output_format: outputFormatSchema.optional(),
});

/**
 * @openapi
 * /api/b2/print:
 *   post:
 *     summary: 送り状発行（フル E2E）
 *     description: check→保存→印刷→PDF取得→追跡番号取得を一括実行（約12秒）
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     responses:
 *       200:
 *         description: 送り状発行結果（tracking_number + PDF）
 */
router.post('/print', async (req, res, next) => {
  try {
    const input = printBodySchema.parse(req.body);
    const session = req.b2session!;
    const defaults = getDefaultShipperFromEnv();
    const shipperZipCode = defaults.shipper_zip_code ?? process.env.B2_DEFAULT_SHIPPER_ZIP ?? '';
    const printType =
      input.print_type ??
      (process.env.B2_DEFAULT_PRINT_TYPE as any) ??
      'm5';

    // auto_shortest が有効な shipment を抽出してバッチ処理
    const needShortest = input.shipments
      .map((s: any, idx: number) => ({ s, idx }))
      .filter(({ s }: any) => s.auto_shortest?.enabled);

    const shortestMap = new Map<number, AutoShortestApplied>();
    if (needShortest.length > 0 && shipperZipCode) {
      const batchResults = await applyAutoShortestBatch(
        needShortest.map(({ s }: any) => ({
          input: s,
          shipment: inputToShipment(s, defaults),
        })),
        shipperZipCode
      );
      needShortest.forEach(({ idx }: any, i: number) => {
        shortestMap.set(idx, batchResults[i].applied);
      });
    }

    const results = [];
    for (const [idx, s] of input.shipments.entries()) {
      let shipment = inputToShipment(s, defaults);
      let applied: AutoShortestApplied | undefined;

      // auto_shortest 適用
      if ((s as any).auto_shortest?.enabled && shortestMap.has(idx)) {
        applied = shortestMap.get(idx)!;
        shipment = {
          ...shipment,
          delivery_date: applied.delivery_date,
          delivery_time_zone: applied.delivery_time_zone,
        };
      }

      if (input.output_format) {
        const r = await printWithFormat(session, shipment, input.output_format);
        results.push({
          tracking_number: r.trackingNumber,
          internal_tracking: r.internalTracking,
          issue_no: r.issueNo,
          search_key4: r.searchKey4,
          pdf_size: r.pdfSize,
          pdf_download_path: generateSignedDownloadPath(r.trackingNumber),
          pdf_base64: toBase64(r.pdf),
          ...(applied ? { auto_shortest_applied: applied } : {}),
        });
      } else {
        const r = await createAndPrint(session, shipment, printType);
        results.push({
          tracking_number: r.trackingNumber,
          internal_tracking: r.internalTracking,
          issue_no: r.issueNo,
          search_key4: r.searchKey4,
          polling_attempts: r.pollingAttempts,
          tracking_attempts: r.trackingAttempts,
          pdf_size: r.pdfSize,
          pdf_download_path: generateSignedDownloadPath(r.trackingNumber),
          pdf_base64: toBase64(r.pdf),
          ...(applied ? { auto_shortest_applied: applied } : {}),
        });
      }
    }

    res.json({ results });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// POST /api/b2/reprint — 再印刷
// ============================================================

/**
 * @openapi
 * /api/b2/reprint:
 *   post:
 *     summary: 発行済み伝票を再印刷
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     responses:
 *       200:
 *         description: 再印刷結果（PDF）
 */
router.post('/reprint', async (req, res, next) => {
  try {
    const input = reprintSchema.parse(req.body);
    const session = req.b2session!;

    if (input.output_format) {
      const entries = await searchHistory(session, {
        trackingNumber: input.tracking_number,
      });
      if (entries.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: `対象伝票が見つかりません: ${input.tracking_number}`,
        });
        return;
      }
      const result = await reprintWithFormat(
        session,
        input.tracking_number,
        input.output_format,
        entries[0].shipment?.service_type as any
      );
      res.json({
        issue_no: result.issueNo,
        pdf_size: result.pdfSize,
        pdf_base64: toBase64(result.pdf),
      });
      return;
    }

    const result = await reprintFullFlow(
      session,
      input.tracking_number,
      input.print_type ?? 'm5'
    );
    res.json({
      issue_no: result.issueNo,
      pdf_size: result.pdfSize,
      polling_attempts: result.pollingAttempts,
      pdf_base64: toBase64(result.pdf),
    });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// GET /api/b2/history — 発行済み伝票検索
// ============================================================

/**
 * @openapi
 * /api/b2/history:
 *   get:
 *     summary: 発行済み伝票を検索（AND 検索、最大100件）
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     parameters:
 *       - name: tracking_number
 *         in: query
 *         schema: { type: string }
 *       - name: search_key4
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 検索結果
 */
router.get('/history', async (req, res, next) => {
  try {
    const params = historySearchSchema.parse({
      tracking_number: q(req.query.tracking_number as any),
      search_key4: q(req.query.search_key4 as any),
      service_type: q(req.query.service_type as any),
      from_date: q(req.query.from_date as any),
      to_date: q(req.query.to_date as any),
    });

    const session = req.b2session!;
    const entries = await searchHistory(session, {
      trackingNumber: params.tracking_number,
      searchKey4: params.search_key4,
      serviceType: params.service_type,
      dateFrom: params.from_date,
      dateTo: params.to_date,
    });

    const limited = entries.slice(0, 100);
    res.json({
      total: entries.length,
      returned: limited.length,
      entries: limited.map((e) => ({
        id: e.id,
        tracking_number: e.shipment?.tracking_number,
        service_type: e.shipment?.service_type,
        consignee_name: e.shipment?.consignee_name,
        consignee_address1: e.shipment?.consignee_address1,
        consignee_address2: e.shipment?.consignee_address2,
        consignee_address3: e.shipment?.consignee_address3,
        item_name1: e.shipment?.item_name1,
        shipment_date: e.shipment?.shipment_date,
        search_key4: e.shipment?.search_key4,
      })),
    });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// GET /api/b2/tracking — 追跡情報取得
// ============================================================

/**
 * @openapi
 * /api/b2/tracking:
 *   get:
 *     summary: 12桁追跡番号で伝票情報を取得
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     parameters:
 *       - name: tracking_number
 *         in: query
 *         schema: { type: string }
 *       - name: search_key4
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 伝票情報
 *       404:
 *         description: 該当伝票なし
 */
router.get('/tracking', async (req, res, next) => {
  try {
    const searchKey4 = q(req.query.search_key4 as any);
    const trackingNumber = q(req.query.tracking_number as any);

    if (!searchKey4 && !trackingNumber) {
      res.status(400).json({
        error: 'BadRequest',
        message: 'search_key4 または tracking_number のいずれか必須',
      });
      return;
    }

    const session = req.b2session!;
    const entries = await searchHistory(session, {
      searchKey4,
      trackingNumber,
    });

    if (entries.length === 0) {
      res.status(404).json({
        error: 'NotFound',
        message: '該当伝票が見つかりません',
      });
      return;
    }

    const first = entries[0];
    res.json({
      tracking_number: first.shipment?.tracking_number,
      service_type: first.shipment?.service_type,
      consignee_name: first.shipment?.consignee_name,
      consignee_address1: first.shipment?.consignee_address1,
      consignee_address2: first.shipment?.consignee_address2,
      consignee_address3: first.shipment?.consignee_address3,
      consignee_address4: first.shipment?.consignee_address4,
      item_name1: first.shipment?.item_name1,
      shipment_date: first.shipment?.shipment_date,
      search_key4: first.shipment?.search_key4,
      shipper_name: first.shipment?.shipper_name,
      raw: first,
    });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// GET /api/b2/saved — 保存済み伝票一覧
// DELETE /api/b2/saved — 保存済み伝票削除
// ============================================================

/**
 * @openapi
 * /api/b2/saved:
 *   get:
 *     summary: 保存済み伝票一覧
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     parameters:
 *       - name: service_type
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 保存済み伝票リスト
 */
router.get('/saved', async (req, res, next) => {
  try {
    const session = req.b2session!;
    const serviceType = q(req.query.service_type as any) as ServiceType | undefined;
    const entries = await listSavedShipments(session, serviceType);
    const limited = entries.slice(0, 100);
    res.json({
      total: entries.length,
      returned: limited.length,
      entries: limited.map((e) => ({
        id: e.id,
        tracking_number: e.shipment?.tracking_number,
        service_type: e.shipment?.service_type,
        consignee_name: e.shipment?.consignee_name,
        search_key4: e.shipment?.search_key4,
      })),
    });
  } catch (e: any) {
    next(e);
  }
});

/**
 * @openapi
 * /api/b2/saved:
 *   delete:
 *     summary: 保存済み伝票を削除
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     responses:
 *       200:
 *         description: 削除結果
 */
router.delete('/saved', async (req, res, next) => {
  try {
    const session = req.b2session!;
    const input = deleteSavedSchema.parse(req.body);
    const all = await listSavedShipments(session);
    const targets: FeedEntry<Shipment>[] = [];
    for (const id of input.ids) {
      const found = all.find((e) => e.shipment?.tracking_number === id);
      if (found) targets.push(found);
    }

    if (targets.length === 0) {
      res.status(404).json({
        error: 'NotFound',
        message: '対象伝票が見つかりません',
      });
      return;
    }

    await deleteSavedShipments(session, targets);
    res.json({ deleted: targets.length });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// GET /api/b2/settings — プリンタ設定取得
// PUT /api/b2/settings — プリンタ種別切替
// ============================================================

/**
 * @openapi
 * /api/b2/settings:
 *   get:
 *     summary: プリンタ設定取得
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     responses:
 *       200:
 *         description: プリンタ設定
 */
router.get('/settings', async (req, res, next) => {
  try {
    const session = req.b2session!;
    const entry = await getSettings(session);
    const gs = (entry as any).general_settings ?? {};
    res.json({
      printer_type: gs.printer_type,
      multi_paper_flg: gs.multi_paper_flg,
      is_tax_rate: gs.is_tax_rate,
      shipment_date_from: gs.shipment_date_from,
      shipment_date_to: gs.shipment_date_to,
      raw: gs,
    });
  } catch (e: any) {
    next(e);
  }
});

/**
 * @openapi
 * /api/b2/settings:
 *   put:
 *     summary: プリンタ種別切替
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     responses:
 *       200:
 *         description: 切替結果
 */
router.put('/settings', async (req, res, next) => {
  try {
    const session = req.b2session!;
    const input = setPrinterTypeSchema.parse(req.body);
    const before = await getSettings(session);
    const beforeType =
      ((before as any).general_settings ?? {}).printer_type as string | undefined;
    await setPrinterType(session, input.printer_type);
    res.json({ success: true, before: beforeType, after: input.printer_type });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// GET /api/b2/pdf — issue_no で PDF 取得（旧方式）
// ============================================================

/**
 * @openapi
 * /api/b2/pdf:
 *   get:
 *     summary: issue_no で PDF 取得（旧方式）
 *     tags: [B2]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     parameters:
 *       - name: issue_no
 *         in: query
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: PDF バイナリ
 *         content:
 *           application/pdf: {}
 */
router.get('/pdf', async (req, res, next) => {
  try {
    const issueNo =
      typeof req.query.issue_no === 'string'
        ? req.query.issue_no
        : Array.isArray(req.query.issue_no)
          ? req.query.issue_no[0]
          : undefined;

    if (!issueNo) {
      res.status(400).json({ error: 'BadRequest', message: 'issue_no パラメータ必須' });
      return;
    }

    const session = req.b2session!;
    const pdf = await downloadPdf(session, issueNo);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${issueNo}.pdf"`);
    res.setHeader('Content-Length', pdf.length.toString());
    res.status(200).send(Buffer.from(pdf));
  } catch (e: any) {
    next(e);
  }
});

export default router;
