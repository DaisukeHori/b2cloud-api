/**
 * スキーマの .shape 抽出テスト
 * TS2589 の回避で .shape を Record<string, z.ZodTypeAny> に抽出しているが、
 * 必須フィールドが欠落していないことを検証する。
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  shipmentInputSchemaBase,
  printTypeSchema,
  outputFormatSchema,
  historySearchSchema,
  reprintSchema,
  deleteSavedSchema,
  setPrinterTypeSchema,
} from '../src/validation';

describe('スキーマ .shape 抽出の整合性', () => {
  it('shipmentInputSchemaBase.shape に必須フィールドが含まれる', () => {
    const shape: Record<string, z.ZodTypeAny> = { ...shipmentInputSchemaBase.shape };
    const required = [
      'service_type',
      'consignee_name',
      'consignee_telephone_display',
      'consignee_zip_code',
      'consignee_address1',
      'consignee_address2',
      'consignee_address3',
      'item_name1',
    ];
    for (const key of required) {
      expect(shape[key]).toBeDefined();
    }
  });

  it('shipmentInputSchemaBase.extend() で print_type/output_format が追加できる', () => {
    const extended = shipmentInputSchemaBase.extend({
      print_type: printTypeSchema.optional(),
      output_format: outputFormatSchema.optional(),
    });
    const shape: Record<string, z.ZodTypeAny> = { ...extended.shape };
    expect(shape.print_type).toBeDefined();
    expect(shape.output_format).toBeDefined();
    expect(shape.service_type).toBeDefined(); // 元のフィールドも残る
  });

  it('historySearchSchema.shape がオブジェクトを返す', () => {
    const shape: Record<string, z.ZodTypeAny> = { ...historySearchSchema.shape };
    expect(Object.keys(shape).length).toBeGreaterThan(0);
  });

  it('reprintSchema.shape に tracking_number が含まれる', () => {
    const shape: Record<string, z.ZodTypeAny> = { ...reprintSchema.shape };
    expect(shape.tracking_number).toBeDefined();
  });

  it('deleteSavedSchema.shape に ids が含まれる', () => {
    const shape: Record<string, z.ZodTypeAny> = { ...deleteSavedSchema.shape };
    expect(shape.ids).toBeDefined();
  });

  it('setPrinterTypeSchema.shape に printer_type が含まれる', () => {
    const shape: Record<string, z.ZodTypeAny> = { ...setPrinterTypeSchema.shape };
    expect(shape.printer_type).toBeDefined();
  });

  it('shipmentInputSchemaBase のフィールド数が 40 以上', () => {
    const fieldCount = Object.keys(shipmentInputSchemaBase.shape).length;
    expect(fieldCount).toBeGreaterThanOrEqual(40);
  });
});
