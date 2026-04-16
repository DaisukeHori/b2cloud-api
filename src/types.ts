/**
 * B2クラウド API TypeScript型定義
 *
 * ★実機検証ベース（2026-04-16）★
 * - フィールド名は全て main-9d4c7b2348.js の getIssueData() から抽出
 * - 値は全て文字列型（msgpackパイプラインと整合）
 * - 各フィールドの詳細は docs/b2cloud-design.md 6章 参照
 *
 * @see https://github.com/DaisukeHori/b2cloud-api/blob/main/docs/b2cloud-design.md
 * @see https://github.com/DaisukeHori/b2cloud-api/blob/main/docs/verification-results.md
 */

// ============================================================
// サービスタイプ
// ============================================================

export type ServiceType =
  | '0'   // 発払い（元払い） ★Phase 1
  | '1'   // EAZY
  | '2'   // コレクト（代金引換）
  | '3'   // クロネコゆうメール（DM）
  | '4'   // タイムサービス ★Phase 1
  | '5'   // 着払い ★Phase 1
  | '6'   // 発払い（複数口）
  | '7'   // クロネコゆうパケット ← Python版は「ネコポス」としていたが誤り
  | '8'   // 宅急便コンパクト ★Phase 1
  | '9'   // コンパクトコレクト
  | 'A';  // ネコポス

// ============================================================
// 印刷タイプ (print_type)
// ============================================================

export type PrintType =
  | 'm'   // A4マルチ（1枚に複数伝票）
  | 'm5'  // A5マルチ（推奨デフォルト）
  | '0'   // 発払い専用紙
  | '3'   // DM/ゆうメール（8面付）
  | '4'   // ラベル(発払い/タイム)
  | '5'   // ラベル(コレクト)
  | '6'   // ラベル(ゆうメール) ※発払い伝票では使用不可
  | '7'   // ラベル(ネコポス/ゆうパケット)
  | '8'   // ラベル(コンパクト)
  | 'A';  // ネコポス専用

// ============================================================
// プリンタタイプ (printer_type)
// ============================================================

export type PrinterType =
  | '1'   // レーザー
  | '2'   // インクジェット
  | '3';  // ラベルプリンタ

// ============================================================
// Shipment（伝票）
// ============================================================

/**
 * 伝票の全フィールド定義
 *
 * ★重要:
 * - 値は全て string（msgpackパイプラインと整合、サーバー側で '0'=false, '1'=true として扱う）
 * - readonly修飾子があるフィールドはサーバー自動補完のため、リクエスト時は送信不要
 * - optionalフィールドはサービスタイプやオプション次第
 *
 * ★invoice_* の正しい組み合わせ（実機確定）:
 * - invoice_code = お客様コード（10桁）例: "0482540070"
 * - invoice_code_ext = "" ← 空文字が正解！
 * - invoice_freight_no = "01" ← 枝番はここに入れる
 * - invoice_name = "" ← 通常空
 */
export interface Shipment {
  // ============================================================
  // 必須フィールド（全サービスタイプ共通）
  // ============================================================

  /** サービス種別 (0-9, A) */
  service_type: ServiceType;

  /** 出荷予定日 "YYYY/MM/DD" または "YYYYMMDD" 形式（本日～30日後） */
  shipment_date: string;

  /** クール便区分: '0'=普通, '1'=冷凍, '2'=冷蔵 */
  is_cool: '0' | '1' | '2';

  /** 最短日フラグ: '0'=指定日, '1'=最短日自動計算 */
  short_delivery_date_flag: '0' | '1';

  /** お届け日印字: '0'=印字しない, '1'=印字する */
  is_printing_date: '0' | '1';

  /** お届け日（is_printing_date='1' && short_delivery_date_flag='0' の時必須、EF011017） */
  delivery_date?: string;

  /** 時間帯コード: '0000'=指定なし, '0812', '1416', '1618', '1820', '1921' 等 */
  delivery_time_zone: string;

  /** 個数 '1'～'99'（複数口時は合計2～99必須、ES002624） */
  package_qty: string;

  /** ご依頼主ロット印字: '1'/'2'/'3' */
  is_printing_lot: '1' | '2' | '3';

  /** 支払い方法フラグ: '0'=月締 */
  payment_flg: string;

  /** 収納代行: '0'=しない, '1'=する（'1'時 12項目必須） */
  is_agent: '0' | '1';

  // ============================================================
  // 請求先（発払い時必須、着払い(5)時は不要）
  // ============================================================

  /** 請求先お客様コード（10桁、B2_CUSTOMER_CODEと同一の場合が多い） */
  invoice_code: string;

  /** ★空文字が正解。枝番を入れるとES006002エラー */
  invoice_code_ext: string;

  /** ★運賃管理番号（枝番）はここ。例: "01" */
  invoice_freight_no: string;

  /** 請求先表示名（通常空） */
  invoice_name: string;

  // ============================================================
  // お届け先（全サービスタイプで必須）
  // ============================================================

  /** お届け先電話番号（ハイフン有無どちらでもOK） */
  consignee_telephone_display: string;

  /** お届け先電話番号内線 */
  consignee_telephone_ext?: string;

  /** お届け先郵便番号（ハイフン有無どちらでもOK） */
  consignee_zip_code: string;

  /** お届け先住所 都道府県 */
  consignee_address1: string;

  /** お届け先住所 市区郡町村（全角12文字/半角24文字以内） */
  consignee_address2: string;

  /** お届け先住所 町・番地（全角16文字/半角32文字以内） */
  consignee_address3: string;

  /** お届け先住所 建物名等（全角16文字/半角32文字以内） */
  consignee_address4?: string;

  /**
   * ★一括住所指定（代替手段）
   * address1/2/3 を指定しない代わりにここに全住所を入れれば、
   * サーバー側で自動分割される。ただし分割ロジックは不完全なので
   * 推奨は address1/2/3 を明示的に指定すること。
   */
  consignee_address?: string;

  /** お届け先名（全角16文字/半角32文字以内） */
  consignee_name: string;

  /** お届け先敬称: '様' (default), '御中', '' */
  consignee_title: '様' | '御中' | '';

  /** お届け先名カナ（半角カタカナのみ、50文字以内） */
  consignee_name_kana?: string;

  /** お届け先部署1（全角25文字/半角50文字以内） */
  consignee_department1?: string;

  /** お届け先部署2 */
  consignee_department2?: string;

  /** お届け先コード（顧客マスタ参照時） */
  consignee_code?: string;

  // ============================================================
  // ご依頼主
  // ============================================================

  /** ご依頼主電話番号 */
  shipper_telephone_display: string;

  /** ご依頼主電話番号内線 */
  shipper_telephone_ext?: string;

  /** ご依頼主郵便番号 */
  shipper_zip_code: string;

  /** ご依頼主住所 都道府県 */
  shipper_address1: string;

  /** ご依頼主住所 市区郡町村 */
  shipper_address2: string;

  /** ご依頼主住所 町・番地 */
  shipper_address3: string;

  /** ご依頼主住所 建物名等 */
  shipper_address4?: string;

  /** ご依頼主名 */
  shipper_name: string;

  /** ご依頼主敬称 */
  shipper_title?: string;

  /** ご依頼主名カナ */
  shipper_name_kana?: string;

  /** ご依頼主コード（顧客マスタ参照時） */
  shipper_code?: string;

  // ============================================================
  // 品名（DM(3)以外必須）
  // ============================================================

  /** 品名1（最大50文字） */
  item_name1?: string;

  /** 品名コード1（半角英数字ハイフンアンダースコアのみ、30文字以内） */
  item_code1?: string;

  /** 品名2 */
  item_name2?: string;

  /** 品名コード2 */
  item_code2?: string;

  // ============================================================
  // 取扱注意事項
  // ============================================================

  /** 記事1 */
  handling_information1?: string;

  /** 記事2 */
  handling_information2?: string;

  /** 備考（全角22文字以内） */
  note?: string;

  // ============================================================
  // 追加オプション
  // ============================================================

  /** 営業所止めサービス利用 */
  is_using_center_service: '0' | '1';

  /** 営業所コード（is_using_center_service='1'時必須） */
  consignee_center_code?: string;

  /** お届け予定eメール */
  is_using_shipment_email: '0' | '1';
  shipment_email_address?: string;
  shipment_message?: string;

  /** お届け完了eメール（有料10円/通） */
  is_using_delivery_email: '0' | '1';
  delivery_email_address?: string;
  delivery_message?: string;

  /** 投函予定メール */
  is_using_shipment_post_email?: '0' | '1';
  shipment_post_email_address?: string;
  shipment_post_message?: string;

  // ============================================================
  // コレクト(2)/コンパクトコレクト(9) 専用
  // ============================================================

  /** 代金引換額（1～300,000円） */
  amount?: string;

  /** 消費税額 */
  tax_amount?: string;

  // ============================================================
  // 複数口(6) 専用
  // ============================================================

  /** 複数口くくりキー（ES002622 回避必須、任意の文字列でOK） */
  closure_key?: string;

  // ============================================================
  // 収納代行（is_agent='1'時に12項目必須、EF011024～EF011036）
  // ============================================================

  agent_amount?: string;
  agent_tax_amount?: string;
  agent_invoice_zip_code?: string;
  agent_invoice_address2?: string;
  agent_invoice_address3?: string;
  agent_invoice_name?: string;
  agent_invoice_kana?: string;
  agent_request_name?: string;
  agent_request_zip_code?: string;
  agent_request_address2?: string;
  agent_request_address3?: string;
  agent_request_telephone?: string;

  // ============================================================
  // 検索キー（追跡番号取得に必須）
  // ============================================================

  /**
   * ★追跡番号取得のためのユニークキー（半角英数字+スペースのみ）
   * これを設定しておかないと history検索で発行後の伝票を特定できない
   */
  search_key_title4?: string;
  search_key4?: string;

  search_key_title1?: string;
  search_key1?: string;
  search_key_title2?: string;
  search_key2?: string;
  search_key_title3?: string;
  search_key3?: string;
  search_key_title5?: string;
  search_key5?: string;

  // ============================================================
  // 制御フラグ（リクエスト時に設定）
  // ============================================================

  /** 発行フラグ: '0'=保存のみ, '1'=発行 */
  shipment_flg?: '0' | '1';

  /** プリンタ種別 */
  printer_type?: PrinterType;

  /** 発送番号（自動採番の場合空） */
  shipment_number?: string;

  // ============================================================
  // サーバー自動補完フィールド（レスポンス受信時に取得）
  // ★リクエスト時は送信不要。型定義では optional として扱う
  // ============================================================

  /** 追跡番号（保存時=UMN形式、発行後=12桁数字） */
  readonly tracking_number?: string;

  /** バリデーション実行日時 */
  readonly checked_date?: string;

  /** 作成日時 */
  readonly created?: string;
  readonly updated?: string;
  readonly update_time?: string;
  readonly created_ms?: string;

  /** 作成者 */
  readonly creator?: string;
  readonly creator_loginid?: string;
  readonly updater?: string;
  readonly updater_loginid?: string;

  /** 入力システム種別 */
  readonly input_system_type?: string;

  /** 仕分コード */
  readonly sorting_code?: string;
  readonly sorting_ab?: string;

  /** ご依頼主担当営業所 */
  readonly shipper_center_code?: string;
  readonly shipper_center_name?: string;
  readonly consignee_center_name?: string;

  /** 顧客コード */
  readonly customer_code?: string;
  readonly customer_code_ext?: string;

  /** 前回履歴フラグ */
  readonly is_previous_flg?: string;

  /** ソート・検索用キー */
  readonly desc_sort_key?: string;
  /** ★注意: 'serch' は原文ママ（B2クラウドのtypo） */
  readonly shipmentdata_serch_key?: string;

  /** 再発行情報 */
  readonly reissue_count?: string;
  readonly is_reissue?: string;
  readonly is_printing_logout?: string;
  readonly is_update_only_tracking_status?: string;

  /** パッケージ連番 */
  readonly package_seq?: string;

  /** ルート配送 */
  readonly is_route_delivery?: string;

  /** 論理削除・表示フラグ */
  readonly display_flg?: string;
  readonly deleted?: string;

  /** エラーフラグ: '0'=完全正常, '9'=警告あり正常 */
  readonly error_flg?: '0' | '9';

  // ============================================================
  // 電話番号（自動正規化後）
  // ============================================================

  readonly consignee_telephone?: string;
  readonly shipper_telephone?: string;
}

// ============================================================
// feed構造
// ============================================================

export interface Feed<T = Shipment> {
  feed: {
    title?: string;       // "Error" または undefined
    subtitle?: string;
    updated?: string;
    entry?: FeedEntry<T>[];
  };
}

export interface FeedEntry<T = Shipment> {
  id?: string;                                   // "/{customerCode}-/{new|history}/{trackingNumber},{revision}"
  link?: Array<{
    ___href: string;
    ___rel?: string;
    ___type?: string;
  }>;
  shipment?: T;
  error?: ErrorInfo[];
  customer?: CustomerInfo;
  system_date?: {
    sys_date: string;   // "YYYYMMDD"
    sys_time: string;   // "HHMMSS"
  };
  summary?: string;
  title?: string;
}

// ============================================================
// エラー情報
// ============================================================

export interface ErrorInfo {
  error_property_name: string;  // フィールド名（例: "consignee_telephone_display"）
  error_code: string;            // "EF011001" 等
  error_description: string;     // 日本語エラーメッセージ
}

// ============================================================
// 顧客情報（レスポンスに含まれる）
// ============================================================

export interface CustomerInfo {
  login_id?: string;
  customer_code: string;
  customer_code_ext?: string;
  customer_name: string;
  customer_center_code?: string;
  sorting_code?: string;
  login_username?: string;
  lastlogin_date?: string;
  eazy_cd?: string;
  nohin_cd?: string;
  levelup_cd?: string;
  api_user_cd?: string;
  invoice: InvoiceInfo[];
  araigaekanryo_flg?: string;
  auth_araigaekanryo_flg?: string;
  araigae_update_date?: string;
  access_token?: string;
  is_kuroneko_yupacket?: string;
}

export interface InvoiceInfo {
  invoice_code: string;          // お客様コード10桁
  invoice_code_ext: string;      // "" が基本
  invoice_freight_no: string;    // "01" 等の枝番
  invoice_name: string;
  is_collect?: string;           // "0"=通常, "1"=コレクト可能
  is_using_credit_card?: string; // "00"=NO, "01"=OK, "02"=制限あり
  is_receiving_agent?: string;   // "00"=NO, "01"=OK
  is_using_qrcode?: string;
  is_using_electronic_money?: string;
  payment?: Array<{ payment_number?: string }>;
}

// ============================================================
// セッション
// ============================================================

export interface B2Session {
  /** 動的検出されたB2クラウドのベースURL（通常 https://newb2web.kuronekoyamato.co.jp/b2） */
  baseUrl: string;

  /** Cookie Jar（tough-cookie） */
  cookieJar: import('tough-cookie').CookieJar;

  /** msgpackパイプラインで使うテンプレート（初回取得後キャッシュ） */
  template: string[] | null;

  /** お客様コード */
  customerCode: string;

  /** 認証情報 */
  customerPassword: string;
  customerClsCode?: string;
  loginUserId?: string;

  /** ログイン日時 */
  loginAt: Date;
}

// ============================================================
// リクエスト/レスポンス型
// ============================================================

export type B2Response<T = Shipment> = Feed<T>;

/** 成功判定ヘルパー */
export function isSuccess<T>(res: B2Response<T>): boolean {
  return res.feed.title !== 'Error';
}

/** エラー抽出ヘルパー */
export function getErrors<T>(res: B2Response<T>): ErrorInfo[] {
  const errors: ErrorInfo[] = [];
  for (const entry of res.feed.entry ?? []) {
    if (entry.error) errors.push(...entry.error);
  }
  return errors;
}

/** error_flg=0 または 9（処理継続可能）の判定 */
export function canProceed<T>(entry: FeedEntry<T>): boolean {
  const flg = (entry.shipment as any)?.error_flg;
  return flg === '0' || flg === '9';
}
