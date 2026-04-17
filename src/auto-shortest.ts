/**
 * auto_shortest 統合ロジック
 *
 * create_and_print_shipment の print フローで、
 * delivery_date と delivery_time_zone を自動差込する。
 *
 * @see docs/date-feature-design_v2.md §7
 */

import type { Shipment } from './types';
import { searchDeliveryDate, type DateSearchResult } from './date';
import {
  buildShortestFromResult,
  type SupportedServiceType,
} from './date-shortest';

/** auto_shortest_applied 診断情報 */
export interface AutoShortestApplied {
  shipment_date: string;
  delivery_date: string;
  delivery_time_zone: string;
  constraint: string;
  constraint_jp: string;
  used_row: 'takkyubin' | 'compactCool';
  cool_requested: boolean;
  cool_available: boolean;
  estimated_arrival: string;
  rationale: string;
}

/** ShipmentInput の最低限の型（循環参照回避） */
interface ShipmentInputLike {
  consignee_zip_code: string;
  service_type: string;
  is_cool?: string;
  shipment_date?: string;
  auto_shortest?: { enabled: true; time_zone_strategy?: 'earliest' | 'unspecified' };
}

function normalizeZip(zip: string): string {
  return zip.replace(/[-ー－]/g, '').replace(/\s/g, '');
}

/**
 * auto_shortest が有効な shipment に対して、delivery_date と delivery_time_zone を
 * 自動差込する。既存の is_cool / service_type は尊重する。
 */
export async function applyAutoShortest(
  input: ShipmentInputLike,
  shipperZipCode: string,
  shipment: Shipment
): Promise<{ shipment: Shipment; applied: AutoShortestApplied }> {
  const strategy = input.auto_shortest?.time_zone_strategy ?? 'earliest';
  const isCool = (input.is_cool ?? '0') as '0' | '1' | '2';
  const serviceType = input.service_type as SupportedServiceType;
  const shipmentDate = input.shipment_date!;

  const rawResult = await searchDeliveryDate({
    shipperZipCode,
    consigneeZipCode: input.consignee_zip_code,
    date: shipmentDate,
    searchKbn: 'shipment',
  });

  const result = buildShortestFromResult(rawResult, serviceType, isCool, shipmentDate.replace(/\//g, '-'));

  const deliveryTimeZone = strategy === 'unspecified' ? '0000' : result.deliveryTimeZone;

  return {
    shipment: {
      ...shipment,
      delivery_date: result.deliveryDate,
      delivery_time_zone: deliveryTimeZone,
    },
    applied: {
      shipment_date: result.shipmentDate,
      delivery_date: result.deliveryDate,
      delivery_time_zone: deliveryTimeZone,
      constraint: result.constraint,
      constraint_jp: result.constraintJp,
      used_row: result.usedRow,
      cool_requested: isCool !== '0',
      cool_available: result.coolAvailable,
      estimated_arrival: result.estimatedArrival,
      rationale: result.rationale,
    },
  };
}

/**
 * バッチ版: shipments 配列に対して並列実行。
 * キャッシュキーは 3タプル (shipperZip, consigneeZip, shipmentDate)
 */
export async function applyAutoShortestBatch(
  inputs: Array<{ input: ShipmentInputLike; shipment: Shipment }>,
  shipperZipCode: string
): Promise<Array<{ shipment: Shipment; applied: AutoShortestApplied }>> {
  const cache = new Map<string, Promise<DateSearchResult>>();

  const promises = inputs.map(async ({ input, shipment }) => {
    const consigneeZip = normalizeZip(input.consignee_zip_code);
    const shipmentDate = input.shipment_date!;
    const cacheKey = `${shipperZipCode}::${consigneeZip}::${shipmentDate}`;

    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        searchDeliveryDate({
          shipperZipCode,
          consigneeZipCode: consigneeZip,
          date: shipmentDate,
          searchKbn: 'shipment',
        })
      );
    }

    const rawResult = await cache.get(cacheKey)!;
    const isCool = (input.is_cool ?? '0') as '0' | '1' | '2';
    const serviceType = input.service_type as SupportedServiceType;
    const strategy = input.auto_shortest?.time_zone_strategy ?? 'earliest';

    const result = buildShortestFromResult(
      rawResult,
      serviceType,
      isCool,
      shipmentDate.replace(/\//g, '-')
    );

    const deliveryTimeZone = strategy === 'unspecified' ? '0000' : result.deliveryTimeZone;

    return {
      shipment: {
        ...shipment,
        delivery_date: result.deliveryDate,
        delivery_time_zone: deliveryTimeZone,
      },
      applied: {
        shipment_date: result.shipmentDate,
        delivery_date: result.deliveryDate,
        delivery_time_zone: deliveryTimeZone,
        constraint: result.constraint,
        constraint_jp: result.constraintJp,
        used_row: result.usedRow,
        cool_requested: isCool !== '0',
        cool_available: result.coolAvailable,
        estimated_arrival: result.estimatedArrival,
        rationale: result.rationale,
      },
    };
  });

  return Promise.all(promises);
}
