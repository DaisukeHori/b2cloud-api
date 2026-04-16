# B2クラウド API 実機検証結果サマリ

**検証日:** 2026-04-16
**検証環境:** ブラウザ（Playwright MCP）経由で本番B2クラウドに直接アクセス
**検証アカウント:** 0482540070（株式会社レボル）
**対象:** newb2web.kuronekoyamato.co.jp

この文書は設計書 `docs/b2cloud-design.md` の補完資料。実機検証で判明した「推測ベースで書かれがちな情報」を**実機確定ベース**に置き換えるための決定版。

---

## 1. 完全E2Eフロー成功（2026-04-16）

### 実機完走結果

```
uniqKey (search_key4): TEST1776307799813
↓ checkonly
error_flg: "0"  ← 完全正常
↓ save
tracking_number: "UMN240309577"  ← 内部管理番号
↓ print issue
issue_no: "UMIN0001077958"
↓ polling → checkonly=1 → PDF download
PDF: 106KB (%PDF ヘッダ付き正常)
↓ history search by search_key4 (18回retry / 約18秒)
tracking: "389711074012"  ← ★ヤマト12桁追跡番号取得成功★
```

**合計所要時間:** 約20秒

### 各ステップの実測時間

| Step | 内容 | 実測時間 |
|------|------|---------|
| 1 | `POST /b2/p/new?checkonly` | ~60ms |
| 2 | `POST /b2/p/new` (save) | ~200ms |
| 3 | `GET /b2/p/new?service_type=0` (get saved) | ~100ms |
| 4 | `POST /b2/p/new?issue&print_type=m5` | ~300ms |
| 5 | `GET /b2/p/polling` (1回目でSuccess) | ~500ms |
| 6 | `GET /b2/p/B2_OKURIJYO?checkonly=1` | ~200ms |
| 7 | `GET /b2/p/B2_OKURIJYO?fileonly=1` (PDF) | ~300ms |
| 8 | `GET /b2/p/history?all&search_key4=...` (18回retry) | ~18秒 |

---

## 2. 最重要発見 — Pythonコードとの差分

### 2-1. `invoice_code_ext` は空文字が正解

| フィールド | 誤った値（Pythonコメント） | 正しい値（実機確定） |
|-----------|------------------------|------------------|
| `invoice_code` | `"0482540070"` | `"0482540070"` ✅ |
| `invoice_code_ext` | `"01"` ← 枝番 **誤** | `""` ← 空文字 **正** |
| `invoice_freight_no` | `"01"` or `""` | `"01"` ← **ここに枝番** |
| `invoice_name` | `""` | `""` |

**検証ソース:** UIの `getIssueData()` が実際に組み立てる値（`main-9d4c7b2348.js` 内で定義）。
UI上で `select_invoice` に `"0482540070-    01"` と表示されるが、これは `invoice_code` + スペース + `invoice_freight_no` を連結したもの。

**誤用時のエラー:** `invoice_code_ext="01"` を入れるとサーバーが `ES006002: 請求先が存在しません` を返す。

### 2-2. `is_agent=1` の必須は12項目（Pythonコメントの「13項目」は誤り）

実機で `is_agent=1` を指定して他を空にした結果、**12項目**がエラーとして返る:

| # | フィールド | エラーコード |
|---|-----------|-------------|
| 1 | `agent_amount` | EF011024 |
| 2 | `agent_tax_amount` | EF011026 |
| 3 | `agent_invoice_zip_code` | EF011027 |
| 4 | `agent_invoice_address2` | EF011028 |
| 5 | `agent_invoice_address3` | EF011029 |
| 6 | `agent_invoice_name` | EF011030 |
| 7 | `agent_invoice_kana` | EF011031 |
| 8 | `agent_request_name` | EF011032 |
| 9 | `agent_request_zip_code` | EF011033 |
| 10 | `agent_request_address2` | EF011034 |
| 11 | `agent_request_address3` | EF011035 |
| 12 | `agent_request_telephone` | EF011036 |

**注意:** このアカウントは収納代行未契約のため、追加で `ES017002: 収納代行は利用できません` が返る。契約済みアカウントではこの警告は消え、上記12項目のみ必須。

### 2-3. `error_flg` の正確な意味

| 値 | 意味 | 処理継続 |
|----|------|:-------:|
| `"0"` | 完全正常（エラーも警告もなし） | ✅ |
| `"9"` | 警告あり正常（`error[]` に警告が返るが処理可能） | ✅ |
| その他 | エラー（保存・発行不可） | ❌ |

**`feed.title = "Error"` の判定:** エラーがあると `feed.title` が `"Error"` になる。成功時は `feed.title` が未定義。

### 2-4. サービスタイプ `7` の正体

- **Python:** ネコポス（誤り）
- **実機確認:** `7` = **クロネコゆうパケット**
- ネコポスは別の `A` コード

---

## 3. print issue の構造（超重要）

### 3-1. entry構造は `id` + `link` 両方必須

```json
{
  "feed": {
    "entry": [
      {
        "id": "/0482540070-/new/UMN240309577,1",     ← 末尾に",{revision}"必須
        "link": [
          {"___href": "/0482540070-/new/UMN240309577", "___rel": "self"}
        ],
        "shipment": {
          /* 保存時の全フィールド */,
          "shipment_flg": "1",
          "printer_type": "1"
        }
      }
    ]
  }
}
```

### 3-2. 組み合わせ別の挙動（実機テスト）

| 構造 | 結果 |
|------|------|
| `id` + `link` 両方 | ✅ 200 OK（issue_no払い出し） |
| `id` のみ | ❌ 409 Conflict |
| `link` のみ | ❌ 500 Server Error |
| `id`も`link`もなし | ❌ 500 Server Error |
| `id` に `,{revision}` なし | ❌ 500 Server Error |

### 3-3. idフォーマット

```
{link[0].___href},{revision}

例:
/0482540070-/new/UMN240309577,1         ← 新規保存
/0482540070-/history/389711074012,1     ← 発行済み（tracking_number=12桁）
```

**フォーマット規則:** `/{customerCode}-/{new|history}/{trackingNumber},{revision}`

- 保存直後（新規）: `new` パス、`tracking_number` は `UMN...` 形式の内部ID、`revision=1`
- 発行済み: `history` パス、`tracking_number` は12桁ヤマト追跡番号、`revision=1` 以上

---

## 4. PDF取得の「2段構え」フロー

### 4-1. 完全な手順

```
1. POST /b2/p/new?issue&print_type=m5&sort1=service_type&sort2=created&sort3=created
   Body: {"feed":{"entry":[{id, link, shipment(shipment_flg='1')}]}}
   → {"feed":{"title":"UMIN0001077958","subtitle":"100"}}

2. GET /b2/p/polling?issue_no=UMIN0001077958&service_no=interman
   → 繰り返し、{"feed":{"title":"Success"}} になるまで
   → 実機: 1回目で即Success（伝票1件の場合）

3. ★重要: GET /b2/p/B2_OKURIJYO?checkonly=1&issue_no=UMIN0001077958
   → 200 OK （再印刷時は必須、新規印刷時は不要だが入れても問題なし）

4. GET /b2/p/B2_OKURIJYO?issue_no=UMIN0001077958&fileonly=1
   → PDF本体 (106KB, 先頭4バイト = %PDF)
```

### 4-2. PDFエラー判別

**成功:** バイナリ先頭4バイト = `0x25 0x50 0x44 0x46` (`%PDF`)

**失敗時（96バイト）:** 
```html
<html>
<script type="text/javascript">
parent.location.href = "/sys_err.html"
</script>
</html>
```

### 4-3. 再印刷時の注意

**reissue（PUT /history?reissue）で新しいissue_noを取得した後、polling成功しても即座にPDFを取りに行くと96B HTMLエラーが返る。**

解決: `B2_OKURIJYO?checkonly=1` を一度挟んでから `fileonly=1` で取得する。

```
Reissue → polling(Success) → ★checkonly=1 → fileonly=1(PDF取得成功)
```

新規印刷(`POST /new?issue`)時は不要だが、毎回実行しても問題なし（冪等）。

---

## 5. ラベルPDFの中身（バイナリ比較）

### 5-1. 同一伝票を異なる `print_type` で再印刷した結果

| print_type | 名称 | サイズ | MediaBox | streamLengths |
|-----------|------|-------|---------|--------------|
| `m` | A4マルチ | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |
| `m5` | A5マルチ | 107,394B | 595×421pt (A5横) | [166,563,26528,631,26576] |
| `4` | ラベル(発払い) | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |
| `5` | ラベル(コレクト) | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |
| `8` | ラベル(コンパクト) | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |

### 5-2. 結論

**ラベル系print_type (`4`/`5`/`8`) と通常A4 (`m`) は内部バイナリ完全同一。** 

streamLengthsが全部同じ `[166, 563, 26528, 631, 26576]` というのは、**PDFの画像・フォント・テキストストリームが完全に同じバイト列**という意味。MediaBoxだけがページサイズ指定を変える役割。

**意味:** 
- B2クラウドは print_type に関わらず基本的に同じA4 PDFを生成する
- サーマルラベルプリンタ用のPDFは存在しない
- ラベル印刷はB2クラウド+クライアントアプリ（localhost:8102のOS常駐アプリ）がA4 PDFから切り出しして印刷している
- **TS実装でサーマルラベル印刷を実現するには、A4 PDFから左上のラベル部分だけを切り出してサイズ変換する後処理が必要**

### 5-3. 実装上の推奨

1. デフォルト: `B2_DEFAULT_PRINT_TYPE=m5` （A5横、実用的なサイズ）
2. ラベル対応: print_type=4/5/8のレスポンスはA4と同じため、PDF切り出しはクライアント側で実装
3. 既存プリンタ設定アプリと連携する場合は print_type=4/5/8 のまま渡す

---

## 6. サーバー自動補完フィールド（保存時に追加される）

checkonlyやsave時、サーバーは以下のフィールドを自動で追加する：

| カテゴリ | フィールド | 例 | 説明 |
|---------|----------|-----|------|
| 日時 | `checked_date` | `"2026-04-16 11:49:59"` | バリデーション実行日時 |
| 日時 | `created` / `updated` / `update_time` | `"2026-04-16 11:49:59"` | 作成・更新日時 |
| 日時 | `created_ms` | `"1776307799988"` | Unix時刻ミリ秒 |
| ユーザー | `creator` / `updater` | `"0482540070-"` | 作成者ID |
| ユーザー | `creator_loginid` / `updater_loginid` | `""` | ログインID |
| システム | `input_system_type` | `"B2"` | 入力システム種別 |
| 配送 | `sorting_code` | `"0196460"` | 仕分コード |
| 配送 | `sorting_ab` | `"B"` | 仕分AB区分 |
| 配送 | `shipper_center_code` | `"124594"` | 担当営業所コード |
| 配送 | `shipper_center_name` | `"川口飯塚営業所（川口飯塚）"` | 担当営業所名 |
| 顧客 | `customer_code` / `customer_code_ext` | `"0482540070"` | 顧客コード |
| フラグ | `is_previous_flg` | `"1"` | 前回履歴フラグ |
| キー | `desc_sort_key` | `"9223370260546975819"` | 降順ソート用キー |
| キー | `shipmentdata_serch_key` | `"00UMN240309577"` | 検索用キー（**typo `serch` 原文ママ**） |
| フラグ | `reissue_count` / `is_reissue` | `"0"` | 再発行回数・フラグ |
| フラグ | `is_printing_logout` | `"0"` | ログアウト後印刷 |
| フラグ | `is_update_only_tracking_status` | `"0"` | 追跡状態のみ更新 |
| 連番 | `package_seq` | `"1"` | パッケージ連番 |
| フラグ | `is_route_delivery` | `"0"` | ルート配送フラグ |
| フラグ | `display_flg` | `"1"` | 表示フラグ（0=論理削除） |
| フラグ | `deleted` | `"0"` | 削除フラグ |
| 結果 | `error_flg` | `"0"` or `"9"` | エラーフラグ |

**TS実装の指針:**
- Shipment型はこれら自動補完フィールドを `readonly` / optional として定義
- リクエスト時は送信不要、レスポンス受信時に読み取るのみ
- `shipmentdata_serch_key` の typo は型定義でもそのまま維持

---

## 7. 各APIエンドポイントの正確な挙動

### 7-1. 保存/取得

| Method | Path | 説明 |
|--------|------|------|
| `GET` | `/b2/p/new?service_type={0-9,A}` | 保存済み伝票一覧（サービス種別で絞込） |
| `POST` | `/b2/p/new?checkonly` | バリデーションのみ（保存しない） |
| `POST` | `/b2/p/new` | 伝票保存（`shipment_flg='0'`） |
| `POST` | `/b2/p/new?issue&print_type=m5&sort1=service_type&sort2=created&sort3=created` | 伝票発行（`shipment_flg='1'`） |
| `PUT` | `/b2/p/new?all&display_flg=0` | 保存済み削除 |

### 7-2. 印刷・PDF取得

| Method | Path | 説明 |
|--------|------|------|
| `GET` | `/b2/p/polling?issue_no={no}&service_no=interman` | 印刷完了確認 |
| `GET` | `/b2/p/B2_OKURIJYO?checkonly=1&issue_no={no}` | PDF生成完了確認（**再印刷時必須**） |
| `GET` | `/b2/p/B2_OKURIJYO?issue_no={no}&fileonly=1` | PDF本体ダウンロード |

### 7-3. 履歴

| Method | Path | 説明 |
|--------|------|------|
| `GET` | `/b2/p/history?all` | 発行済み全件 |
| `GET` | `/b2/p/history?all&search_key4={key}` | 検索キーで検索（**追跡番号取得に必須**） |
| `GET` | `/b2/p/history?all&tracking_number={no}` | 追跡番号で検索 |
| `PUT` | `/b2/p/history?reissue&print_type=m5&sort1=service_type&sort2=created&sort3=created` | 再印刷（`id`+`link`必須） |
| `PUT` | `/b2/p/history?display_flg=0` | 履歴論理削除 |

### 7-4. 設定

| Method | Path | 説明 |
|--------|------|------|
| `GET` | `/b2/d/_settings/template` | フィールド定義テンプレート（1115行） |
| `GET` | `/b2/d/initdisplay?service_no=interman&panel_id=single_issue_reg.html` | 初期表示情報 — ⚠️**Access denied が頻発、ランタイム取得推奨** |

---

## 8. msgpack+zlib パイプラインの実機確認

### 8-1. 圧縮率

| フォーマット | サイズ | 圧縮率 |
|------------|-------|-------|
| JSON | 585 bytes | 100% |
| msgpack | 418 bytes | 71% |
| msgpack + zlib（raw deflate） | **205 bytes** | **35%（65%削減）** |

### 8-2. HTTPヘッダ

```http
POST /b2/p/new?checkonly HTTP/1.1
Content-Type: application/x-msgpack; charset=x-user-defined
Content-Encoding: deflate
Cookie: {B2クラウドセッション}

[raw deflate bytes]
```

### 8-3. 応答

**送信形式に関わらずレスポンスは常にJSON。**
`Content-Type: application/json;charset=UTF-8`

つまりTSで実装する際、**送信時のみmsgpack処理が必要**。受信側は通常の `res.json()` でOK。

### 8-4. pako（Node.js）と元JSのzlib_asmの違い

| 実装 | 出力フォーマット | ヘッダ除去 |
|------|--------------|----------|
| 元JS `zlib_asm.compress` | zlib形式（先頭2byte、末尾4byteあり） | `subarray(2, -4)` で手動除去 |
| Node.js `pako.deflateRaw` | raw deflate（ヘッダ/フッタなし） | **除去不要** |

TS実装では `deflateRaw` を使えば元JSのsubarray処理を再現する必要なし。

---

## 9. UIフォームから判明したshipment標準フィールド

`main-9d4c7b2348.js` の `getIssueData()` 関数をブラウザ上で実行した結果、発払い時に返される標準shipmentのキー一覧（全て文字列）：

```
service_type, is_cool, shipment_date, short_delivery_date_flag,
is_printing_date, delivery_time_zone, shipment_number,
invoice_code, invoice_code_ext, invoice_freight_no, invoice_name,
package_qty, is_printing_lot, is_agent, payment_flg,
consignee_telephone_display, consignee_telephone_ext,
consignee_zip_code, consignee_address1, is_using_center_service,
consignee_address2, consignee_address3, consignee_address4,
consignee_department1, consignee_department2,
consignee_name, consignee_title, consignee_name_kana, consignee_code,
shipper_telephone_display, shipper_telephone_ext,
shipper_zip_code, shipper_address1, shipper_address2,
shipper_address3, shipper_address4,
shipper_name, shipper_title, shipper_name_kana, shipper_code,
item_code1, item_name1, item_code2, item_name2,
handling_information1, handling_information2, note,
is_using_shipment_email, is_using_delivery_email, closure_key,
search_key_title1, search_key1, search_key_title2, search_key2,
search_key_title3, search_key3, search_key_title4, search_key4,
shipment_flg
```

**フィールド総数:** 57項目（UI基本表示）

---

## 10. 未検証事項 — Node.js環境で要確認

以下はブラウザ実機検証では判明しないため、Node.js実装時に確認が必要：

1. **tough-cookie + undici で3ドメイン間のCookie共有が正しく動作するか**
   - `bmypageapi.kuronekoyamato.co.jp`
   - `bmypage.kuronekoyamato.co.jp`
   - `newb2web.kuronekoyamato.co.jp`

2. **TLS cipher要件**
   - B2クラウドは古いTLS設定の可能性あり
   - Python版では `AES128-SHA` を強制指定している
   - Node.jsでも必要か要検証

3. **`Origin` ヘッダの必要性**
   - ブラウザからはデフォルトで付く
   - Node.jsから呼ぶときに省略可能か要検証

4. **セッションタイムアウト**
   - Cookieの有効期限
   - 401/403時の自動再ログイン実装

5. **レート制限**
   - 連続リクエスト時のスロットリング有無
   - 1分あたりの上限

---

## 11. 検証環境

- ブラウザ: Chromium (Playwright MCP経由)
- 検証ツール: Playwright-MCP (https://playwright-mcp.appserver.tokyo)
- 検証日: 2026-04-16
- 検証アカウント: 株式会社レボル (0482540070)
- 伝票例:
  - `UMN240309577` / `UMIN0001077958` / `389711074012`
  - `UMN240309950` / `UMIN0001067794`（タイムアウト例）
  - 既存伝票 `487462947650`（reissue検証に使用）

---

**この検証結果は TypeScript 実装の基準となる。疑問が生じたら再度ブラウザ実機で検証して本ドキュメントを更新すること。**
