/**
 * MCP サーバー定義（@modelcontextprotocol/sdk 方式）
 *
 * cloudflare-mcp / ssh-mcp と同じパターン:
 *   createServer() → McpServer を生成 → 12 ツールを登録 → return
 *
 * api/mcp.ts が StreamableHTTPServerTransport で接続する。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { login, resolveLoginConfig } from './auth';
import type { B2Session } from './types';
import {
  shipmentInputSchema,
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
  TOOL_DESCRIPTIONS,
} from './mcp-tools';

// ============================================================
// セッションラッパー
// ============================================================

/**
 * B2 セッションを自動作成してハンドラを実行する。
 * 各ツール呼び出しで新規ログイン（ステートレス方針）。
 */
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

  // ── create_and_print_shipment ─────────────────────────────────
  server.registerTool(
    'create_and_print_shipment',
    {
      title: '送り状発行（一括）',
      description: TOOL_DESCRIPTIONS.create_and_print_shipment,
      inputSchema: shipmentInputSchema
        .extend({
          print_type: printTypeSchema.optional(),
          output_format: outputFormatSchema.optional(),
        })
        .shape,
    },
    async (args) => withSession((s) => createAndPrintShipmentTool(s, args))
  );

  // ── validate_shipment ─────────────────────────────────────────
  server.registerTool(
    'validate_shipment',
    {
      title: 'バリデーション',
      description: TOOL_DESCRIPTIONS.validate_shipment,
      inputSchema: shipmentInputSchema.shape,
    },
    async (args) => withSession((s) => validateShipmentTool(s, args))
  );

  // ── save_shipment ─────────────────────────────────────────────
  server.registerTool(
    'save_shipment',
    {
      title: '伝票保存',
      description: TOOL_DESCRIPTIONS.save_shipment,
      inputSchema: shipmentInputSchema.shape,
    },
    async (args) => withSession((s) => saveShipmentTool(s, args))
  );

  // ── print_saved_shipments ─────────────────────────────────────
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

  // ── search_history ────────────────────────────────────────────
  server.registerTool(
    'search_history',
    {
      title: '発行済み伝票検索',
      description: TOOL_DESCRIPTIONS.search_history,
      inputSchema: historySearchSchema.shape,
    },
    async (args) => withSession((s) => searchHistoryTool(s, args))
  );

  // ── get_tracking_info ─────────────────────────────────────────
  server.registerTool(
    'get_tracking_info',
    {
      title: '追跡情報取得',
      description: TOOL_DESCRIPTIONS.get_tracking_info,
      inputSchema: {
        tracking_number: z.string().min(1),
      },
    },
    async (args) => withSession((s) => getTrackingInfoTool(s, args))
  );

  // ── reprint_shipment ──────────────────────────────────────────
  server.registerTool(
    'reprint_shipment',
    {
      title: '再印刷',
      description: TOOL_DESCRIPTIONS.reprint_shipment,
      inputSchema: reprintSchema.shape,
    },
    async (args) => withSession((s) => reprintShipmentTool(s, args))
  );

  // ── delete_saved_shipments ────────────────────────────────────
  server.registerTool(
    'delete_saved_shipments',
    {
      title: '保存済み伝票削除',
      description: TOOL_DESCRIPTIONS.delete_saved_shipments,
      inputSchema: deleteSavedSchema.shape,
    },
    async (args) => withSession((s) => deleteSavedShipmentsTool(s, args))
  );

  // ── get_account_info ──────────────────────────────────────────
  server.registerTool(
    'get_account_info',
    {
      title: 'アカウント情報',
      description: TOOL_DESCRIPTIONS.get_account_info,
      inputSchema: {},
    },
    async (args) => withSession((s) => getAccountInfoTool(s, args))
  );

  // ── list_saved_shipments ──────────────────────────────────────
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

  // ── get_printer_settings ──────────────────────────────────────
  server.registerTool(
    'get_printer_settings',
    {
      title: 'プリンタ設定取得',
      description: TOOL_DESCRIPTIONS.get_printer_settings,
      inputSchema: {},
    },
    async (args) => withSession((s) => getPrinterSettingsTool(s, args))
  );

  // ── set_printer_type ──────────────────────────────────────────
  server.registerTool(
    'set_printer_type',
    {
      title: 'プリンタ種別切替',
      description: TOOL_DESCRIPTIONS.set_printer_type,
      inputSchema: setPrinterTypeSchema.shape,
    },
    async (args) => withSession((s) => setPrinterTypeTool(s, args))
  );

  return server;
}
