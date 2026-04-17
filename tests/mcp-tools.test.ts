/**
 * mcp-tools.ts テスト（ツールカタログの整合性のみ、ネットワーク非依存）
 */

import { describe, it, expect } from 'vitest';
import { TOOL_DESCRIPTIONS } from '../src/mcp-tools';

describe('TOOL_DESCRIPTIONS カタログ', () => {
  const names = Object.keys(TOOL_DESCRIPTIONS);

  it('ツール数は 12 以上（設計書 9-1）', () => {
    expect(names.length).toBeGreaterThanOrEqual(12);
  });

  it('各ツールは description を持つ', () => {
    for (const name of names) {
      const desc = (TOOL_DESCRIPTIONS as any)[name];
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it('名前が一意', () => {
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
    for (const r of required) {
      expect(names).toContain(r);
    }
  });
});
