/**
 * mcp-tools.ts テスト（ツールカタログの整合性のみ、ネットワーク非依存）
 */

import { describe, it, expect } from 'vitest';
import { MCP_TOOLS } from '../src/mcp-tools';

describe('MCP_TOOLS カタログ', () => {
  it('ツール数は 12 以上（設計書 9-1）', () => {
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

  it('設計書 9-1 の必須ツールが含まれる', () => {
    const required = [
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
    ];
    const names = MCP_TOOLS.map((t) => t.name);
    for (const r of required) {
      expect(names).toContain(r);
    }
  });
});
