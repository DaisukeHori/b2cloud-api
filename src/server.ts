// @ts-nocheck — MCP SDK の registerTool ジェネリクスが 70+ フィールドで TS2589 を起こすため
/**
 * MCP サーバー定義（@modelcontextprotocol/sdk 方式）
 *
 * cloudflare-mcp / ssh-mcp と同じパターン:
 *   createServer() → McpServer を生成 → 12 ツールを登録 → return
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { login, resolveLoginConfig } from './auth';
import type { B2Session } from './types';
import {
  shipmentInputSchemaBase,
  printTypeSchema,
  outputFormatSchema,
  historySearchSchema,
  reprintSchema,
  deleteSavedSchema,
  setPrinterTypeSchema,
} from './validation';
import {
  createAndPrintShipmentTool,
  validateShipmentTool,
  saveShipmentTool,
  printSavedShipmentsTool,
  searchHistoryTool,
  getTrackingInfoTool,
  reprintShipmentTool,
  deleteSavedShipmentsTool,
  getAccountInfoTool,
  listSavedShipmentsTool,
  getPrinterSettingsTool,
  setPrinterTypeTool,
  searchDeliveryDateTool,
  findShortestDeliverySlotTool,
  TOOL_DESCRIPTIONS,
} from './mcp-tools';

// ============================================================
// inputSchema を事前に Record<string, z.ZodTypeAny> として抽出
// ※ SDK のジェネリクスが 70+ フィールドの Zod shape で TS2589 を起こすため
// ============================================================

const createPrintSchema: Record<string, z.ZodTypeAny> = {
  ...shipmentInputSchemaBase.shape,
  print_type: printTypeSchema.optional(),
  output_format: outputFormatSchema.optional(),
};

const shipmentSchema: Record<string, z.ZodTypeAny> = { ...shipmentInputSchemaBase.shape };
const historySchema: Record<string, z.ZodTypeAny> = { ...historySearchSchema.shape };
const reprintInputSchema: Record<string, z.ZodTypeAny> = { ...reprintSchema.shape };
const deleteInputSchema: Record<string, z.ZodTypeAny> = { ...deleteSavedSchema.shape };
const printerTypeInputSchema: Record<string, z.ZodTypeAny> = { ...setPrinterTypeSchema.shape };

// ============================================================
// セッションラッパー
// ============================================================

async function withSession(
  fn: (session: B2Session) => Promise<{ content: any[]; isError?: boolean }>
) {
  const config = resolveLoginConfig();
  const session = await login(config);
  return fn(session);
}

// ============================================================
// McpServer 生成
// ============================================================

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'b2cloud-api',
    version: '0.1.0',
  });

  server.registerTool(
    'create_and_print_shipment',
    {
      title: '送り状発行（一括）',
      description: TOOL_DESCRIPTIONS.create_and_print_shipment,
      inputSchema: createPrintSchema,
    },
    async (args) => withSession((s) => createAndPrintShipmentTool(s, args))
  );

  server.registerTool(
    'validate_shipment',
    {
      title: 'バリデーション',
      description: TOOL_DESCRIPTIONS.validate_shipment,
      inputSchema: shipmentSchema,
    },
    async (args) => withSession((s) => validateShipmentTool(s, args))
  );

  server.registerTool(
    'save_shipment',
    {
      title: '伝票保存',
      description: TOOL_DESCRIPTIONS.save_shipment,
      inputSchema: shipmentSchema,
    },
    async (args) => withSession((s) => saveShipmentTool(s, args))
  );

  server.registerTool(
    'print_saved_shipments',
    {
      title: '保存済み伝票印刷',
      description: TOOL_DESCRIPTIONS.print_saved_shipments,
      inputSchema: {
        tracking_numbers: z.array(z.string().min(1)).min(1),
        print_type: printTypeSchema.optional(),
        output_format: outputFormatSchema.optional(),
      },
    },
    async (args) => withSession((s) => printSavedShipmentsTool(s, args))
  );

  server.registerTool(
    'search_history',
    {
      title: '発行済み伝票検索',
      description: TOOL_DESCRIPTIONS.search_history,
      inputSchema: historySchema,
    },
    async (args) => withSession((s) => searchHistoryTool(s, args))
  );

  server.registerTool(
    'get_tracking_info',
    {
      title: '追跡情報取得',
      description: TOOL_DESCRIPTIONS.get_tracking_info,
      inputSchema: { tracking_number: z.string().min(1) },
    },
    async (args) => withSession((s) => getTrackingInfoTool(s, args))
  );

  server.registerTool(
    'reprint_shipment',
    {
      title: '再印刷',
      description: TOOL_DESCRIPTIONS.reprint_shipment,
      inputSchema: reprintInputSchema,
    },
    async (args) => withSession((s) => reprintShipmentTool(s, args))
  );

  server.registerTool(
    'delete_saved_shipments',
    {
      title: '保存済み伝票削除',
      description: TOOL_DESCRIPTIONS.delete_saved_shipments,
      inputSchema: deleteInputSchema,
    },
    async (args) => withSession((s) => deleteSavedShipmentsTool(s, args))
  );

  server.registerTool(
    'get_account_info',
    {
      title: 'アカウント情報',
      description: TOOL_DESCRIPTIONS.get_account_info,
      inputSchema: {},
    },
    async (args) => withSession((s) => getAccountInfoTool(s, args))
  );

  server.registerTool(
    'list_saved_shipments',
    {
      title: '保存済み伝票一覧',
      description: TOOL_DESCRIPTIONS.list_saved_shipments,
      inputSchema: {
        service_type: z
          .enum(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'])
          .optional(),
        search_key4: z.string().optional(),
      },
    },
    async (args) => withSession((s) => listSavedShipmentsTool(s, args))
  );

  server.registerTool(
    'get_printer_settings',
    {
      title: 'プリンタ設定取得',
      description: TOOL_DESCRIPTIONS.get_printer_settings,
      inputSchema: {},
    },
    async (args) => withSession((s) => getPrinterSettingsTool(s, args))
  );

  server.registerTool(
    'set_printer_type',
    {
      title: 'プリンタ種別切替',
      description: TOOL_DESCRIPTIONS.set_printer_type,
      inputSchema: printerTypeInputSchema,
    },
    async (args) => withSession((s) => setPrinterTypeTool(s, args))
  );

  // ── search_delivery_date ───────────────────────────────────
  server.registerTool(
    'search_delivery_date',
    {
      title: '配達予定日検索',
      description: TOOL_DESCRIPTIONS.search_delivery_date,
      inputSchema: {
        shipper_zip_code: z.string().min(1),
        consignee_zip_code: z.string().min(1),
        date: z.string().optional(),
      },
    },
    async (args) => {
      // date API は B2 セッション不要だが withSession のシグネチャに合わせる
      return searchDeliveryDateTool(null as any, args);
    }
  );

  // ── find_shortest_delivery_slot ───────────────────────────
  server.registerTool(
    'find_shortest_delivery_slot',
    {
      title: '最短配達スロット',
      description: TOOL_DESCRIPTIONS.find_shortest_delivery_slot,
      inputSchema: {
        consignee_zip_code: z.string().min(1),
        shipper_zip_code: z.string().optional(),
        service_type: z.enum(['0', '2', '5', '6', '8', '9']).optional(),
        is_cool: z.enum(['0', '1', '2']).optional(),
        shipment_date: z.string().optional(),
      },
    },
    async (args) => {
      return findShortestDeliverySlotTool(null as any, args);
    }
  );

  return server;
}
