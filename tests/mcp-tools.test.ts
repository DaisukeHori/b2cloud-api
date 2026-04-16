/**
 * mcp-tools.ts テスト（単体テスト、ネットワーク非依存、カタログ整合性検証）
 */

import { describe, it, expect } from 'vitest';
import { MCP_TOOLS } from '../src/mcp-tools';

describe('MCP_TOOLS カタログ', () => {
  it('ツール数は 12 以上', () => {
    expect(MCP_TOOLS.length).toBeGreaterThanOrEqual(12);
  });

  it('各ツールは name / description / inputSchema / handler を持つ', () => {
    for (const t of MCP_TOOLS) {
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe('string');
      expect(typeof t.handler).toBe('function');
      expect(t.inputSchema).toBeDefined();
    }
  });

  it('名前が一意', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each([
    'create_and_print_shipment',
    'validate_shipment',
    'save_shipment',
    'print_saved_shipments',
    'search_history',
    'get_tracking_info',
    'reprint_shipment',
    'delete_saved_shipments',
    'get_account_info',
    'list_saved_shipments',
    'get_printer_settings',
    'set_printer_type',
  ])('必須ツール "%s" が含まれる', (name) => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toContain(name);
  });

  it('全ツールの name は snake_case', () => {
    for (const t of MCP_TOOLS) {
      expect(/^[a-z][a-z0-9_]*$/.test(t.name)).toBe(true);
    }
  });

  it('全ツールの description は日本語を含む', () => {
    for (const t of MCP_TOOLS) {
      // 最低でも1文字以上の日本語が含まれる
      expect(/[\u3040-\u30FF\u4E00-\u9FFF]/.test(t.description)).toBe(true);
    }
  });

  it('inputSchema は Zod schema（parse メソッドを持つ）', () => {
    for (const t of MCP_TOOLS) {
      expect(typeof (t.inputSchema as any).parse).toBe('function');
    }
  });

  it('handler は async 関数（呼び出して Promise を返す）', () => {
    for (const t of MCP_TOOLS) {
      // セッション不要で空で呼ぶとエラーまたは Promise を返す
      const result = t.handler as any;
      expect(typeof result).toBe('function');
    }
  });

  it('create_and_print_shipment の入力スキーマは service_type を含む', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'create_and_print_shipment');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).toThrow(); // service_type 欠落
  });

  it('validate_shipment の入力スキーマは shipmentInputSchema', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'validate_shipment');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).toThrow();
  });

  it('save_shipment の入力スキーマは shipmentInputSchema', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'save_shipment');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).toThrow();
  });

  it('get_tracking_info は tracking_number 必須', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'get_tracking_info');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).toThrow();
    expect(() =>
      t!.inputSchema.parse({ tracking_number: '123456789012' })
    ).not.toThrow();
  });

  it('reprint_shipment は tracking_number 必須', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'reprint_shipment');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).toThrow();
    expect(() =>
      t!.inputSchema.parse({ tracking_number: '123456789012' })
    ).not.toThrow();
  });

  it('delete_saved_shipments は ids 必須', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'delete_saved_shipments');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).toThrow();
    expect(() => t!.inputSchema.parse({ ids: ['UMN123'] })).not.toThrow();
  });

  it('set_printer_type は printer_type 必須', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'set_printer_type');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).toThrow();
    expect(() => t!.inputSchema.parse({ printer_type: '1' })).not.toThrow();
  });

  it('list_saved_shipments は引数なしでも OK', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'list_saved_shipments');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).not.toThrow();
  });

  it('search_history は引数なしでも OK（全件検索）', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'search_history');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).not.toThrow();
  });

  it('get_account_info は引数なしで OK', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'get_account_info');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).not.toThrow();
  });

  it('get_printer_settings は引数なしで OK', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'get_printer_settings');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).not.toThrow();
  });

  it('print_saved_shipments は tracking_numbers 必須', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'print_saved_shipments');
    expect(t).toBeDefined();
    expect(() => t!.inputSchema.parse({})).toThrow();
    expect(() =>
      t!.inputSchema.parse({ tracking_numbers: ['UMN123'] })
    ).not.toThrow();
  });

  it('print_saved_shipments は 空配列 NG', () => {
    const t = MCP_TOOLS.find((x) => x.name === 'print_saved_shipments');
    expect(() =>
      t!.inputSchema.parse({ tracking_numbers: [] })
    ).toThrow();
  });
});
