/**
 * MCP ツール定義（@modelcontextprotocol/sdk）
 *
 * ★設計書 9章 参照★
 *
 * ツール一覧:
 *   - create_and_print_shipment   伝票作成→印刷→PDF取得
 *   - validate_shipment           checkonly のみ
 *   - save_shipment               伝票保存のみ
 *   - print_saved_shipments       保存済み伝票を印刷
 *   - search_history              発行済み伝票検索
 *   - get_tracking_info           追跡番号で伝票情報取得
 *   - reprint_shipment            再印刷
 *   - delete_saved_shipments      保存済み削除
 *   - get_account_info            アカウント情報
 *   - list_saved_shipments        保存済み一覧
 *   - get_printer_settings        プリンタ設定取得
 *   - set_printer_type            プリンタ種別切替
 */

import { z } from 'zod';
import type { B2Session, FeedEntry, Shipment } from './types';
import {
  createAndPrint,
  reprintFullFlow,
  reprintIssue,
  downloadPdf,
  pollUntilSuccess,
  printIssue,
} from './print';
import {
  checkShipment,
  saveShipment,
  listSavedShipments,
  searchHistory,
  deleteSavedShipments,
  findSavedBySearchKey4,
} from './shipment';
import {
  getSettings,
  setPrinterType,
  printWithFormat,
  reprintWithFormat,
} from './settings';
import {
  shipmentInputSchema,
  historySearchSchema,
  reprintSchema,
  deleteSavedSchema,
  setPrinterTypeSchema,
  outputFormatSchema,
  printTypeSchema,
  inputToShipment,
  getDefaultShipperFromEnv,
  type ShipmentInput,
} from './validation';
import { B2ValidationError } from './b2client';
import { toBase64, errorMessage } from './utils';

// ============================================================
// MCP レスポンス型（@modelcontextprotocol/sdk 互換）
// ============================================================

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      };
    };

export interface McpCallToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

// ============================================================
// 共通ヘルパー
// ============================================================

function ok(text: string, extra: McpContentBlock[] = []): McpCallToolResult {
  return { content: [{ type: 'text', text }, ...extra], isError: false };
}

function err(text: string): McpCallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function pdfContentBlock(
  _pdf: Uint8Array,
  trackingNumber: string
): McpContentBlock {
  // PDFをbase64で返すとレスポンスが100KB超になりLLMが処理できないため、
  // ダウンロードパスのみ返す。
  // ファイル名: {tracking_number}.pdf
  return {
    type: 'text',
    text: `[PDF] /api/b2/download?tracking_number=${trackingNumber} → ${trackingNumber}.pdf`,
  };
}

function formatValidationError(e: B2ValidationError): string {
  if (e.errors.length === 0) return e.message;
  return (
    'バリデーションエラー:\n' +
    e.errors
      .map(
        (er) =>
          `- ${er.error_code}: ${er.error_property_name} — ${er.error_description}`
      )
      .join('\n')
  );
}

// ============================================================
// ツール実装
// ============================================================

/**
 * create_and_print_shipment: 伝票作成→印刷→PDF取得→12桁追跡番号取得
 */
export async function createAndPrintShipmentTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const schema = shipmentInputSchema.extend({
      print_type: printTypeSchema.optional(),
      output_format: outputFormatSchema.optional(),
    });
    const input = schema.parse(rawInput);
    const shipment = inputToShipment(input, getDefaultShipperFromEnv());

    // output_format 指定時は自動でプリンタ種別切替
    if (input.output_format) {
      const result = await printWithFormat(session, shipment, input.output_format);
      return ok(
        JSON.stringify(
          {
            issueNo: result.issueNo,
            trackingNumber: result.trackingNumber,
            internalTracking: result.internalTracking,
            searchKey4: result.searchKey4,
            pdfSize: result.pdfSize,
          },
          null,
          2
        ),
        [pdfContentBlock(result.pdf, result.trackingNumber)]
      );
    }

    const result = await createAndPrint(
      session,
      shipment,
      input.print_type ?? (process.env.B2_DEFAULT_PRINT_TYPE as any) ?? 'm5'
    );

    return ok(
      JSON.stringify(
        {
          issueNo: result.issueNo,
          trackingNumber: result.trackingNumber,
          internalTracking: result.internalTracking,
          searchKey4: result.searchKey4,
          pollingAttempts: result.pollingAttempts,
          trackingAttempts: result.trackingAttempts,
          pdfSize: result.pdfSize,
        },
        null,
        2
      ),
      [pdfContentBlock(result.pdf, result.trackingNumber)]
    );
  } catch (e) {
    if (e instanceof B2ValidationError) return err(formatValidationError(e));
    if (e instanceof z.ZodError) {
      return err(
        '入力エラー:\n' +
          e.errors
            .map((er) => `- ${er.path.join('.')}: ${er.message}`)
            .join('\n')
      );
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * validate_shipment: checkonly のみ
 */
export async function validateShipmentTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const input = shipmentInputSchema.parse(rawInput) as ShipmentInput;
    const shipment = inputToShipment(input, getDefaultShipperFromEnv());
    const checked = await checkShipment(session, shipment);
    return ok(
      JSON.stringify(
        {
          valid: true,
          error_flg: checked.shipment?.error_flg,
          checked_date: checked.shipment?.checked_date,
          tracking_number: checked.shipment?.tracking_number, // UMN...
        },
        null,
        2
      )
    );
  } catch (e) {
    if (e instanceof B2ValidationError) return err(formatValidationError(e));
    if (e instanceof z.ZodError) {
      return err(
        '入力エラー:\n' +
          e.errors
            .map((er) => `- ${er.path.join('.')}: ${er.message}`)
            .join('\n')
      );
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * save_shipment: 伝票保存のみ（印刷しない）
 */
export async function saveShipmentTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const input = shipmentInputSchema.parse(rawInput);
    const shipment = inputToShipment(input, getDefaultShipperFromEnv());
    const checked = await checkShipment(session, shipment);
    const saved = await saveShipment(session, checked);
    return ok(
      JSON.stringify(
        {
          tracking_number: saved.shipment?.tracking_number, // UMN...
          id: saved.id,
          href: saved.link?.[0]?.___href,
        },
        null,
        2
      )
    );
  } catch (e) {
    if (e instanceof B2ValidationError) return err(formatValidationError(e));
    if (e instanceof z.ZodError) {
      return err(
        '入力エラー:\n' +
          e.errors
            .map((er) => `- ${er.path.join('.')}: ${er.message}`)
            .join('\n')
      );
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * print_saved_shipments: 保存済み伝票を印刷（UMN形式の tracking_number で指定）
 */
export async function printSavedShipmentsTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const schema = z.object({
      tracking_numbers: z.array(z.string().min(1)).min(1),
      print_type: printTypeSchema.optional(),
      output_format: outputFormatSchema.optional(),
    });
    const input = schema.parse(rawInput);

    // 保存済み一覧から該当エントリを取得
    const savedList = await listSavedShipments(session);
    const targets: FeedEntry<Shipment>[] = [];
    for (const tn of input.tracking_numbers) {
      const found = savedList.find((e) => e.shipment?.tracking_number === tn);
      if (!found) {
        return err(`保存済み伝票が見つかりません: ${tn}`);
      }
      targets.push(found);
    }

    // 複数件を1件ずつ印刷（簡易実装、大量時は別設計要）
    const pdfs: McpContentBlock[] = [];
    const summary: any[] = [];
    const printType = input.print_type ?? 'm5';

    for (const target of targets) {
      const issueNo = await printIssue(session, target, printType);
      await pollUntilSuccess(session, issueNo);
      const pdf = await downloadPdf(session, issueNo);
      pdfs.push(pdfContentBlock(pdf, target.shipment?.tracking_number ?? issueNo));
      summary.push({
        tracking_number: target.shipment?.tracking_number,
        issue_no: issueNo,
        pdf_size: pdf.length,
      });
    }

    return ok(JSON.stringify({ printed: summary }, null, 2), pdfs);
  } catch (e) {
    if (e instanceof B2ValidationError) return err(formatValidationError(e));
    if (e instanceof z.ZodError) {
      return err(`入力エラー: ${JSON.stringify(e.errors)}`);
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * search_history: 発行済み伝票検索
 */
export async function searchHistoryTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const input = historySearchSchema.parse(rawInput);
    const entries = await searchHistory(session, {
      searchKey4: input.search_key4,
      trackingNumber: input.tracking_number,
      serviceType: input.service_type,
      dateFrom: input.from_date,
      dateTo: input.to_date,
    });

    // 最大50件に制限（9-3 参照）
    const summary = entries.slice(0, 50).map((e) => ({
      tracking_number: e.shipment?.tracking_number,
      service_type: e.shipment?.service_type,
      consignee_name: e.shipment?.consignee_name,
      consignee_address1: e.shipment?.consignee_address1,
      shipment_date: e.shipment?.shipment_date,
      created: e.shipment?.created,
      search_key4: e.shipment?.search_key4,
    }));

    return ok(
      JSON.stringify(
        { total: entries.length, limited: entries.length > 50, entries: summary },
        null,
        2
      )
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return err(`入力エラー: ${JSON.stringify(e.errors)}`);
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * get_tracking_info: 12桁追跡番号で伝票情報を取得
 */
export async function getTrackingInfoTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const schema = z.object({ tracking_number: z.string().min(1) });
    const input = schema.parse(rawInput);
    const entries = await searchHistory(session, {
      trackingNumber: input.tracking_number,
    });
    if (entries.length === 0) {
      return err(`追跡番号が見つかりません: ${input.tracking_number}`);
    }
    return ok(JSON.stringify({ shipment: entries[0].shipment }, null, 2));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return err(`入力エラー: ${JSON.stringify(e.errors)}`);
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * reprint_shipment: 発行済み伝票を再印刷
 */
export async function reprintShipmentTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const input = reprintSchema.parse(rawInput);

    if (input.output_format) {
      // 既存伝票の service_type を取得して label 可否判定
      const entries = await searchHistory(session, {
        trackingNumber: input.tracking_number,
      });
      if (entries.length === 0) {
        return err(`追跡番号が見つかりません: ${input.tracking_number}`);
      }
      const serviceType = entries[0].shipment?.service_type;
      const result = await reprintWithFormat(
        session,
        input.tracking_number,
        input.output_format,
        serviceType as any
      );
      return ok(
        JSON.stringify(
          {
            issueNo: result.issueNo,
            pdfSize: result.pdfSize,
          },
          null,
          2
        ),
        [pdfContentBlock(result.pdf, input.tracking_number)]
      );
    }

    const result = await reprintFullFlow(
      session,
      input.tracking_number,
      input.print_type ?? 'm5'
    );
    return ok(
      JSON.stringify(
        {
          issueNo: result.issueNo,
          pdfSize: result.pdfSize,
          pollingAttempts: result.pollingAttempts,
        },
        null,
        2
      ),
      [pdfContentBlock(result.pdf, input.tracking_number)]
    );
  } catch (e) {
    if (e instanceof B2ValidationError) return err(formatValidationError(e));
    if (e instanceof z.ZodError) {
      return err(`入力エラー: ${JSON.stringify(e.errors)}`);
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * delete_saved_shipments: 保存済み伝票を削除（UMN形式 ID 指定）
 */
export async function deleteSavedShipmentsTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const input = deleteSavedSchema.parse(rawInput);

    // 全保存済みから該当 ID を抽出
    const savedList = await listSavedShipments(session);
    const targets: FeedEntry<Shipment>[] = [];
    for (const id of input.ids) {
      const found = savedList.find((e) => e.shipment?.tracking_number === id);
      if (found) targets.push(found);
    }

    if (targets.length === 0) {
      return err('削除対象の伝票が見つかりません');
    }

    await deleteSavedShipments(session, targets);
    return ok(JSON.stringify({ deleted: targets.length }, null, 2));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return err(`入力エラー: ${JSON.stringify(e.errors)}`);
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * get_account_info: アカウント情報（checkonly のレスポンスに含まれる customer オブジェクト）
 */
export async function getAccountInfoTool(
  session: B2Session
): Promise<McpCallToolResult> {
  try {
    // 空 shipment を checkonly して customer 情報を取得
    // （bare checkonly は一部フィールドでエラーが出るため、最小シップメントを用意）
    const today = new Date();
    const ymd = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
    const dummyShipment: Shipment = {
      service_type: '0',
      shipment_date: ymd,
      is_cool: '0',
      short_delivery_date_flag: '1',
      is_printing_date: '1',
      delivery_time_zone: '0000',
      package_qty: '1',
      is_printing_lot: '2',
      is_agent: '0',
      payment_flg: '0',
      invoice_code: process.env.B2_CUSTOMER_CODE ?? '',
      invoice_code_ext: '',
      invoice_freight_no: process.env.B2_DEFAULT_INVOICE_FREIGHT_NO ?? '01',
      invoice_name: '',
      consignee_telephone_display: '03-0000-0000',
      consignee_zip_code: '100-0001',
      consignee_address1: '東京都',
      consignee_address2: '千代田区',
      consignee_address3: '千代田1-1',
      consignee_name: 'Test',
      consignee_title: '様',
      is_using_center_service: '0',
      shipper_telephone_display: '00-0000-0000',
      shipper_zip_code: '000-0000',
      shipper_address1: '',
      shipper_address2: '',
      shipper_address3: '',
      shipper_name: '',
      item_name1: '',
      is_using_shipment_email: '0',
      is_using_delivery_email: '0',
    };
    try {
      const entry = await checkShipment(session, dummyShipment);
      return ok(
        JSON.stringify(
          {
            customer: entry.customer,
            system_date: entry.system_date,
          },
          null,
          2
        )
      );
    } catch (e) {
      // バリデーションエラーでも customer 情報は含まれる
      if (e instanceof B2ValidationError) {
        return ok(
          JSON.stringify(
            {
              note: 'ダミー shipment でバリデーションエラー（customer 取得のみ）',
              errors: e.errors.slice(0, 3),
            },
            null,
            2
          )
        );
      }
      throw e;
    }
  } catch (e) {
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * list_saved_shipments: 保存済み伝票一覧
 */
export async function listSavedShipmentsTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const schema = z.object({
      service_type: z
        .enum(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'])
        .optional(),
      search_key4: z.string().optional(),
    });
    const input = schema.parse(rawInput ?? {});

    const entries = await listSavedShipments(session, input.service_type);
    const filtered = input.search_key4
      ? entries.filter((e) => e.shipment?.search_key4 === input.search_key4)
      : entries;

    const summary = filtered.slice(0, 50).map((e) => ({
      tracking_number: e.shipment?.tracking_number,
      service_type: e.shipment?.service_type,
      consignee_name: e.shipment?.consignee_name,
      shipment_date: e.shipment?.shipment_date,
      search_key4: e.shipment?.search_key4,
    }));

    return ok(
      JSON.stringify(
        {
          total: filtered.length,
          limited: filtered.length > 50,
          entries: summary,
        },
        null,
        2
      )
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return err(`入力エラー: ${JSON.stringify(e.errors)}`);
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * get_printer_settings: 現在のプリンタ設定を取得
 */
export async function getPrinterSettingsTool(
  session: B2Session
): Promise<McpCallToolResult> {
  try {
    const entry = await getSettings(session);
    const gs = (entry as any).general_settings ?? {};
    return ok(
      JSON.stringify(
        {
          printer_type: gs.printer_type,
          multi_paper_flg: gs.multi_paper_flg,
          is_tax_rate: gs.is_tax_rate,
          shipment_date_from: gs.shipment_date_from,
          shipment_date_to: gs.shipment_date_to,
        },
        null,
        2
      )
    );
  } catch (e) {
    return err(`エラー: ${errorMessage(e)}`);
  }
}

/**
 * set_printer_type: プリンタ種別を切替
 */
export async function setPrinterTypeTool(
  session: B2Session,
  rawInput: unknown
): Promise<McpCallToolResult> {
  try {
    const input = setPrinterTypeSchema.parse(rawInput);
    const entry = await getSettings(session);
    const before = ((entry as any).general_settings ?? {}).printer_type;
    await setPrinterType(session, input.printer_type);
    return ok(
      JSON.stringify(
        { success: true, before, after: input.printer_type },
        null,
        2
      )
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return err(`入力エラー: ${JSON.stringify(e.errors)}`);
    }
    return err(`エラー: ${errorMessage(e)}`);
  }
}

// ============================================================
// ツールカタログ（名前 → 実装のマップ）
// ============================================================

/**
 * 入力スキーマ付きのツール定義（MCP サーバーへの登録用）
 *
 * 設計書 9-1 参照
 */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (
    session: B2Session,
    args: unknown
  ) => Promise<McpCallToolResult>;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'create_and_print_shipment',
    description: `ヤマト運輸 B2クラウドで送り状を発行し、PDFと12桁追跡番号を返す一気通貫ツール。
内部で バリデーション→保存→印刷→PDF取得→追跡番号取得 を自動実行（約12〜20秒）。

★重要: 依頼主（発送元）・請求先はサーバー側で自動設定済。ユーザーに聞く必要なし。
  お届け先の情報と品名だけ渡せば即発行できる。
  get_account_info や get_printer_settings を事前に呼ぶ必要もない。
  このツールを直接呼ぶだけでよい。

■ 必要な項目（お届け先 + 品名だけ）:
  service_type: 伝票種別。通常は "0"（発払い）でOK
  consignee_name: お届け先名（例: "山田太郎"）
  consignee_telephone_display: お届け先電話（ハイフン付き、例: "03-1234-5678"）
  consignee_zip_code: お届け先郵便番号（例: "100-0014"）
  consignee_address1: 都道府県（例: "東京都"）
  consignee_address2: 市区町村（例: "千代田区"）
  consignee_address3: 町・番地（例: "永田町1-7-1"）
  item_name1: 品名（例: "書類"、"化粧品"）

  ※ consignee_address4: 建物・部屋番号は別フィールド（例: "与野ティーズガーデン201"）

■ service_type 一覧:
  "0" = 発払い（元払い）← 最も一般的、迷ったらこれ
  "2" = コレクト（代金引換）← amount（税込金額）が追加で必須
  "3" = DM便
  "4" = タイムサービス ← delivery_time_zone は "0010"(午前中) か "0017"(午後) のみ
  "5" = 着払い ← invoice_code 不要
  "6" = 発払い（複数口）← closure_key + package_qty が必須
  "7" = クロネコゆうパケット
  "8" = 宅急便コンパクト ← 専用BOX使用
  "9" = コンパクトコレクト ← amount が追加で必須
  "A" = ネコポス

■ よく使うオプション:
  shipment_date: 出荷日（"YYYY/MM/DD"、省略=本日）
  item_name2: 品名2
  is_cool: "0"=普通 / "1"=冷凍 / "2"=冷蔵（デフォルト "0"）
  delivery_time_zone: 配達時間帯（"0000"=指定なし, "0812"=午前中, "1416"=14-16時, "1618"=16-18時, "1820"=18-20時, "1921"=19-21時）
  note: 記事欄（最大44文字）
  handling_information1: 荷扱い情報1（最大20文字、例: "ワレモノ注意"）
  package_qty: 個数（文字列、デフォルト "1"）

■ 印刷設定（通常は省略でOK）:
  print_type: 用紙種別（デフォルト "m5"=A5マルチ）
    "m"=A4マルチ, "m5"=A5マルチ, "4"=ラベル発払い
  output_format: "a4_multi" / "a5_multi" / "label"（指定すると printer_type を自動切替）

■ 依頼主の上書き（ユーザーが明示的に変更を求めた場合のみ使用）:
  shipper_name, shipper_telephone_display, shipper_zip_code, shipper_address1/2/3
  ※ 通常は自動設定されるので指定不要。ユーザーから聞き出す必要もない。

■ コレクト(2)/コンパクトコレクト(9)専用:
  amount: 代引金額（"1"〜"300000"、税込）

■ 戻り値:
  tracking_number: ヤマト12桁追跡番号（例: "389717757822"）
  issue_no: 発行番号（例: "UMIN0000023737"）
  pdfSize: PDFファイルサイズ（バイト）
  search_key4: 検索用ユニークキー
  ※ PDFダウンロード: /api/b2/download?tracking_number={tracking_number}&key={api_key}
    ブラウザで開けば 389717757822.pdf として表示される。
    ユーザーにはこのURLを案内すること。`,
    inputSchema: shipmentInputSchema.extend({
      print_type: printTypeSchema.optional(),
      output_format: outputFormatSchema.optional(),
    }),
    handler: createAndPrintShipmentTool,
  },
  {
    name: 'validate_shipment',
    description:
      '伝票データのバリデーションのみ（B2クラウドへの checkonly 実行）。保存はしない。',
    inputSchema: shipmentInputSchema,
    handler: validateShipmentTool,
  },
  {
    name: 'save_shipment',
    description: '伝票を保存のみ（印刷しない）。戻り値は tracking_number (UMN...)',
    inputSchema: shipmentInputSchema,
    handler: saveShipmentTool,
  },
  {
    name: 'print_saved_shipments',
    description:
      '保存済み伝票を印刷。tracking_number (UMN...) の配列で指定。PDF を返す。',
    inputSchema: z.object({
      tracking_numbers: z.array(z.string().min(1)).min(1),
      print_type: printTypeSchema.optional(),
      output_format: outputFormatSchema.optional(),
    }),
    handler: printSavedShipmentsTool,
  },
  {
    name: 'search_history',
    description: '発行済み伝票を検索（AND 検索、最大50件）',
    inputSchema: historySearchSchema,
    handler: searchHistoryTool,
  },
  {
    name: 'get_tracking_info',
    description: '12桁追跡番号で伝票情報を取得',
    inputSchema: z.object({ tracking_number: z.string().min(1) }),
    handler: getTrackingInfoTool,
  },
  {
    name: 'reprint_shipment',
    description:
      '発行済み伝票を再印刷（checkonly=1 → fileonly=1 の2段階フロー、設計書 4-7）',
    inputSchema: reprintSchema,
    handler: reprintShipmentTool,
  },
  {
    name: 'delete_saved_shipments',
    description:
      '保存済み伝票を削除（DELETE /b2/p/new、msgpack+zlib 必須、設計書 4-11）',
    inputSchema: deleteSavedSchema,
    handler: deleteSavedShipmentsTool,
  },
  {
    name: 'get_account_info',
    description: 'アカウント情報（customer、請求先、営業所等）を取得',
    inputSchema: z.object({}),
    handler: getAccountInfoTool,
  },
  {
    name: 'list_saved_shipments',
    description: '保存済み伝票一覧（service_type / search_key4 で絞込可能、最大50件）',
    inputSchema: z.object({
      service_type: z
        .enum(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'])
        .optional(),
      search_key4: z.string().optional(),
    }),
    handler: listSavedShipmentsTool,
  },
  {
    name: 'get_printer_settings',
    description: '現在のプリンタ設定を取得（GET /b2/p/settings）',
    inputSchema: z.object({}),
    handler: getPrinterSettingsTool,
  },
  {
    name: 'set_printer_type',
    description:
      'プリンタ種別を切替（"1"=レーザー, "2"=インクジェット, "3"=ラベル、read-modify-write で PUT /b2/p/settings）',
    inputSchema: setPrinterTypeSchema,
    handler: setPrinterTypeTool,
  },
];
