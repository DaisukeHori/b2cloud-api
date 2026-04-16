# B2クラウド API/MCPサーバー 設計書

**プロジェクト名:** b2cloud-api
**リポジトリ:** DaisukeHori/b2cloud-api
**バージョン:** v1.5.0
**最終更新:** 2026-04-16
**言語:** TypeScript
**デプロイ先:** Vercel（ワンボタンデプロイ対応）

---

## 0. この設計書について

Claude Code による自立実装を目的とした**完全仕様書**。ブラウザ実機検証と Node.js 環境での E2E 実装検証で確定した情報のみを記載。

### 0-1. 実機検証完了項目

- ✅ ログインフロー（ヤマトビジネスメンバーズ → B2クラウド動的URL検出、4段階）
- ✅ **Node.js環境での認証フロー完全動作** — undici + tough-cookie で 3-5秒でログイン完走（302リダイレクト追跡含む、詳細: 3-1〜3-5）
- ✅ msgpack+zlibパイプライン（f2a/e2a/t2m/t2m2 実機動作確認、ブラウザ/Node.js両方で同一バイト列生成・サーバー 200応答確認）
- ✅ JSONフォールバックパス（同一エンドポイントで動作確認、Node.js環境でも動作確認）
- ✅ 完全E2Eフロー（checkonly → save → print → polling → PDF → 追跡番号取得、約20秒で完走、Node.js/ブラウザ両方で再現）
- ✅ 全バリデーションルール（必須項目・文字数制限・フォーマット・40+エラーコード）
- ✅ 全サービスタイプ（発払い/タイム/着払い/コンパクト/コレクト/複数口/ネコポス/ゆうパケット/DM/EAZY）
- ✅ **PDF出力は3軸で決まる: `shipment.service_type` × `general_settings.printer_type` × `print_type`**（5-3-2参照）
  - 最大影響: `service_type`（伝票種別でレイアウト全体が決まる）
  - 大: `general_settings.printer_type`（A4 or ラベル専用サイズ切替）
  - 中: `print_type`（整合性チェック + 一部バリエーション選択）
- ✅ `/b2/p/settings` API（GET/PUT、read-modify-write必須）
- ✅ 再印刷時のPDF取得フロー（`B2_OKURIJYO?checkonly=1` 完了確認が必須）
- ✅ invoice_* フィールドの正しい組み合わせ（`invoice_code_ext=""`、`invoice_freight_no="01"`）
- ✅ print issue entry構造（`id` + `link` 両方必須、`id`末尾に`,{revision}`）
- ✅ タイムサービス(`service_type=4`)専用の`delivery_time_zone`値（`"0010"` / `"0017"`）
- ✅ **Origin / Referer / X-Requested-With ヘッダが CSRF対策として必須**（無いと `417 Expectation Failed` が返る。Node.js実装で実機確定、4-9参照）
- ✅ **msgpackパイプライン用テンプレートは `/tmp/template.dat`（base64、460行）** — `/b2/d/_settings/template` (1115行) はクライアント用の別物で送信時に使うと shipment 配列のインデックスがズレる（3-4参照）
- ✅ **t2m の Atom Feed 定義で `author{}` の子は `" name"`, `" uri"`, `" email"` (先頭スペース付き)** — スペース無しで書くと entry 配列のトップレベルが3個多くなる

### 0-2. 実機E2E完走サンプル

| 項目 | 値 |
|------|-----|
| uniqKey (search_key4) | `TEST1776307799813` |
| 内部管理番号 | `UMN240309577` |
| issue_no | `UMIN0001077958` |
| **ヤマト12桁追跡番号** | **`389711074012`** |
| 合計所要時間 | 約20秒（tracking取得に18回retry/18秒） |

**PDFサイズ実測値（同じprint_type=m でもservice_typeでこれだけ違う）:**

| 条件 | PDFサイズ | MediaBox |
|------|----------|---------|
| 発払い(0) + レーザー(`printer_type=1`) | 105KB | 595×842pt (A4縦) |
| 着払い(5) + レーザー(1) | 91KB | 595×842pt (A4縦) — 内容別物 |
| コンパクト(8) + レーザー(1) | 119KB | 595×842pt (A4縦) — 内容別物 |
| 発払い(0) + ラベル(`printer_type=3`) | 57KB | 326.551×561.543pt (115.1×198.1mm) |
| 発払い(0) + ラベル(3) + `print_type=4` | 70KB | 339.023×669.543pt (119.6×236.1mm) — 専用発払いラベル |

---

## 1. プロジェクト概要

### 1-1. 目的

ヤマト運輸「送り状発行システムB2クラウド」のWebフロントエンドAPIをリバースエンジニアリングし、TypeScriptで再実装したREST API + MCPサーバー。Vercelにワンボタンデプロイ可能。

### 1-2. 元リポジトリとの関係

| 項目 | 元リポジトリ (Python) | 本プロジェクト (TypeScript) |
|------|---------------------|--------------------------|
| 作者 | Interman Corporation | DaisukeHori |
| 言語 | Python 3 | TypeScript (Node.js 20+) |
| API通信 | msgpack+zlib（Python手動再実装） | **msgpack+zlib（元JSから直接TS移植）** + JSONフォールバック |
| サーバーURL | newb2web-s2 **ハードコード** | ME0002.jsonから**動的検出** |
| デプロイ | Flask/Zappa/Colab | Vercel Serverless |
| ネコポスのコード | 未定義 | `A` |
| プリンタ設定API | 未利用 | `GET/PUT /b2/p/settings`（4-1参照） |

**★ Python 元コードには少なくとも12件のバグがあり、うち4件は重大（誤ったデフォルト値・フィールド構造）。詳細は 10章参照。**

### 1-3. 通信プロトコル: 元JSの二系統、実装方針はJSONデフォルト

**重要な再発見（Node.js E2E検証で確定）:** B2クラウドの元JSは**用途に応じて2つのパイプラインを使い分けている**:

| クライアント | 使用プロトコル | 利用箇所 |
|------------|-------------|--------|
| `$.b2fetch.get/post/put/delete` | **JSON** (`application/json; charset=UTF-8`) | 伝票の個別 CRUD、履歴取得、ポーリング、設定など **通常のAPI操作全て** |
| `MPUploader.post/put/delete` | **msgpack + zlib (raw deflate)** | **大量一括インポート専用**（外部データ一括発行ページ等、CSV由来の多件 shipment 送信） |

つまり **msgpack+zlib は「通常APIのデフォルト」ではなく、大量一括バッチ専用のオプション**である。設計書初期の推定（msgpack = デフォルト）は誤り。

**本プロジェクトの実装方針（確定）:**

| パス | 用途 |
|------|------|
| **JSON（デフォルト）** | 全API呼び出し。実機で `$.b2fetch` と同じ挙動、E2E完走確認済み |
| **msgpack+zlib（オプション）** | `useMsgpack: true` 指定時のみ。50件以上の一括送信で圧縮率1-2%の恩恵（付録D実測値）。要テンプレートロード |

**msgpack を使わないと決めたわけではない**。ただし msgpack はテンプレート依存があり、一致しないと全フィールドが別位置にズレる落とし穴がある（実測で確認）。小件数では JSON との速度差はほぼ無いため、**まずは JSON で実装し、大量バッチのみ msgpack**が現実的。

**JSON 動作の実機確認結果（Node.js + undici + tough-cookie）:** E-1 で checkonly/save/print/polling が全て 200 で完走、shipment の全フィールドが正しく echo back されることを確認。

### 1-4. 対象サービスタイプ

**Phase 1（MVP）:**

| service_type | 名称 | ラベル印刷 | 備考 |
|-------------|------|:---------:|------|
| `0` | 発払い（元払い） | ✅ | 最も一般的、専用ラベル `print_type=4` |
| `4` | タイムサービス | ✅ | `delivery_time_zone` は `"0010"`/`"0017"` のみ（6-2-T参照） |
| `5` | 着払い | ❌ | invoice_code不要、**ラベル印刷不可**（レーザー設定必須） |
| `8` | 宅急便コンパクト | ❌ | 専用BOX使用、**ラベル印刷不可**（レーザー設定必須） |

**Phase 2:**

| service_type | 名称 | ラベル印刷 | 備考 |
|-------------|------|:---------:|------|
| `2` | コレクト（代金引換） | ✅ | `amount` 必須、専用ラベル `print_type=2` |
| `3` | クロネコゆうメール（DM） | ❌ | `item_name1` 不要、**ラベル印刷不可** |
| `6` | 発払い（複数口） | — | `closure_key` + `package_qty` 合計2〜99必須 |
| `7` | クロネコゆうパケット | ✅ | 専用ラベル `print_type=7` |
| `9` | コンパクトコレクト | ❌ | `amount` 必須、**ラベル印刷不可** |
| `A` | ネコポス | ✅ | 専用ラベル `print_type=A`、投函完了メール機能あり |

**非対応（参考）:**

| service_type | 名称 | 理由 |
|-------------|------|------|
| `1` | EAZY | アカウント単位の契約が必要（`ES002005` エラー）。本検証アカウントでは契約外のため実装対象外 |

### 1-5. 技術スタック

| レイヤー | 技術 |
|---------|------|
| ランタイム | Node.js 20+ |
| フレームワーク | Express（Vercel Serverless Functions） |
| MCP SDK | `@modelcontextprotocol/sdk` |
| HTTP通信 | `undici`（Node.js内蔵）+ `tough-cookie` |
| msgpackエンコード | `@msgpack/msgpack`（**元JSから直接移植、Python再実装不使用**） |
| zlib圧縮 | `pako`（deflateRaw、元JSのzlib_asm.compress相当） |
| PDF操作 | `pdf-lib`（分割・情報取得） |
| 型定義 | Zod（入力バリデーション） |
| ビルド | TSC（CommonJS出力、Vercel互換） |
| テスト | Vitest |

---

## 2. アーキテクチャ

### 2-1. ディレクトリ構造

```
b2cloud-api/
├── api/
│   ├── mcp.ts                 # MCP SSEエンドポイント
│   ├── b2/
│   │   ├── login.ts           # POST /api/b2/login
│   │   ├── check.ts           # POST /api/b2/check
│   │   ├── save.ts            # POST /api/b2/save
│   │   ├── print.ts           # POST /api/b2/print
│   │   ├── pdf.ts             # GET  /api/b2/pdf
│   │   ├── history.ts         # GET  /api/b2/history
│   │   ├── saved.ts           # GET/DELETE /api/b2/saved
│   │   ├── reprint.ts         # POST /api/b2/reprint
│   │   ├── tracking.ts        # GET  /api/b2/tracking（search_key4検索で12桁追跡番号取得）
│   │   └── settings.ts        # GET/PUT /api/b2/settings（プリンタ設定切替）
│   └── health.ts              # GET  /api/health
├── src/
│   ├── b2client.ts            # B2クラウドHTTPクライアント（msgpack/JSON両対応）
│   ├── msgpack.ts             # msgpack+zlib圧縮パイプライン（元JSのf2a/e2a/t2m/t2m2直接移植）
│   ├── auth.ts                # ログイン + 環境変数/ヘッダーからの LoginConfig 解決
│   ├── shipment.ts            # 伝票CRUD操作
│   ├── print.ts               # 印刷/PDF取得（createAndPrint/printWithFormat含む）
│   ├── settings.ts            # general_settings read-modify-write（setPrinterType）
│   ├── validation.ts          # 入力バリデーション（Zod）
│   ├── types.ts               # TypeScript型定義
│   ├── mcp-tools.ts           # MCPツール定義
│   └── utils.ts               # ユーティリティ
├── vercel.json
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

> **ステートレス方針 (2026-04-16 確定):** セッションキャッシュ層 (`session-store.ts`) は持たない。各リクエストで新規ログイン (3-5秒) を実行する。Vercel Serverless はインスタンス間で状態共有不可、設計書 E-3 #8 (セッションタイムアウト時間) と E-5 #17 (複数インスタンス共有) も未検証のため、推測ベースの永続化を避けて確実な動作を優先する。バッチ用途は将来 `/api/b2/batch` で対応予定。

### 2-2. セッションフロー

```
┌──────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  クライアント   │────▶│  b2cloud-api      │────▶│  B2クラウド       │
│  (MCP/REST)   │◀────│  (Vercel)         │◀────│  (ヤマト運輸)     │
└──────────────┘     └───────────────────┘     └─────────────────┘
                            │
                     ┌──────┴──────┐
                     │ SessionStore │
                     │ (Cookie管理)  │
                     └─────────────┘
```

**セッションのライフサイクル:**

1. 初回リクエスト時にログイン→Cookie取得→テンプレート取得→SessionStoreにキャッシュ
2. 以降のリクエストはキャッシュ済みCookieとテンプレートを再利用
3. Cookie失効（401/403）時に自動再ログイン
4. Vercelのコールドスタートでも再ログインで復帰

### 2-3. msgpack+zlib圧縮パイプライン（`src/msgpack.ts`）

**このセクションは設計書で最も実装に近い部分。** B2クラウドの本来のプロトコル（msgpack+zlib）を、元JavaScriptから直接TypeScriptに移植するためのリファレンス。以下8つのサブセクションで構成:

| # | 内容 |
|---|------|
| 2-3-1 | マルチページ構造と msgpack 利用箇所の全体像 |
| 2-3-2 | 移植元 JS ファイルの一覧（398KB + 513KB のvendorライブラリ） |
| 2-3-3 | ワイヤーフォーマット完全検証結果（手動バイト列組立→POST 200成功） |
| 2-3-4 | B2クラウドJS内の2つのHTTPクライアント（`$.b2fetch` / `MPUploader`） |
| 2-3-5 | 圧縮パイプライン本体の元JS → TS直接移植（`compressFeed()`） |
| 2-3-6 | 元JS関数群 f2a/e2a/t2m/t2m2 の完全ソース |
| 2-3-7 | 定数 FIELD_PATTERN, CONTROL_CODE, replaceControlCode |
| 2-3-8 | 3つのcheckonly関数のバリエーション |

### 2-3-1. B2クラウドはページ機能ごとに別のmain.jsを持つマルチページアプリ

B2クラウドはSPAではなく、**各機能ページ（`single_issue_reg.html`、`history_issue_search.html`等）ごとに別々のmain.jsを配信する**マルチページアプリケーション。全main.jsを実機検証した結果:

| ページ | main.js | サイズ | msgpack+zlib |
|-------|---------|-------|:------------:|
| メインメニュー | `main-75daae5226.js` | 235KB | ❌ |
| **1件ずつ発行（伝票作成）** | **`main-9d4c7b2348.js`** | **398KB** | **✅** |
| **履歴検索** | **`main-fdc5d67653.js`** | **482KB** | **✅** |
| **外部データ一括発行** | **`main-0db2f3eaa7.js`** | **593KB** | **✅** |
| **保存済み伝票検索** | **`main-abaec08cc7.js`** | **463KB** | **✅** |
| 一般設定 | `main-4474421ae6.js` | 245KB | ❌ |
| プリンタ設定 | `main-9a4ae540ac.js` | 175KB | ❌ |

**核心機能（伝票作成・履歴検索・一括発行・保存検索）は全てmsgpack+zlibパイプラインを持つ。** メニューや設定画面などAPI呼び出しが軽量なページはJSON化されているが、実API操作を行うページは全てmsgpackが現役で使われている。

**実装方針（確定）:**
- **msgpack+zlibをデフォルトとする** — B2クラウドの主要機能が全てmsgpackを使っているため、本来のプロトコルに合わせる
- **JSONフォールバック** — `useJson: true`指定時、またはmsgpackでエラー時の自動リトライ
- **移植元ファイル** — 伝票作成フローの完全実装が含まれる **`main-9d4c7b2348.js`**（single_issue_reg用）を第一参照とする

**参考（新しいJSON実装の`$.b2fetch.post`、軽量ページのみ使用）:**
```javascript
// main-75daae5226.js等の軽量ページで使用される簡易版
function(n) {
  var r = JSON.stringify(n.data);
  e.ajax({
    type: "post",
    url: "/b2" + n.url,
    contentType: "application/json; charset=UTF-8",
    dataType: "json",
    data: r
  })
}
```

### 2-3-2. 元JSソースファイル（移植元）

| ファイル | サイズ | URL | 内容 |
|---------|-------|-----|------|
| **`main-9d4c7b2348.js`** | **398KB** | `/scripts/main-9d4c7b2348.js` | **伝票作成用メインロジック。f2a/e2a/t2m/t2m2関数、FIELD_PATTERN、replaceControlCode、MPUploader、$.b2fetch全定義、msgpack+zlib圧縮パイプライン** |
| `vdr-3ee93e23a5.js` | 349KB | `/scripts/vdr-3ee93e23a5.js` | vendorライブラリ1（jQuery等） |
| `vdr2-3010403877.js` | 513KB | `/scripts/vdr2-3010403877.js` | vendorライブラリ2（msgpack実装 + zlib_asm実装） |

**★これらのファイルは現役配信中。** `single_issue_reg.html`（1件ずつ発行ページ）が今もこのファイル群を読み込んでいる。

**移植元は上記のJSファイル。** Pythonの再実装コードではない。

### 2-3-3. ワイヤーフォーマット完全検証結果

ブラウザ上で元JSのf2a/msgpack.encode/zlib_asm.compressを使って実際にバイト列を組み立て、`/b2/p/new?checkonly`へ直接POSTした結果、**完全に動作することを確認**。

**送信バイト列の構造（17フィールドのshipment 1件の場合）:**

| ステップ | 内容 | サイズ |
|---------|------|-------|
| 1. JSON相当 | `{"feed":{"entry":[{"shipment":{...}}]}}` | 585 bytes |
| 2. f2a出力（配列） | 15要素配列（先頭14個null、最後がentry配列） | — |
| 3. msgpack.encode | 先頭 `9f` = fixarray(15)、続いて `c0`×14 = null×14、`91`=fixarray(1), `dc 00 48`=array(72フィールド) | 418 bytes |
| 4. zlib_asm.compress | 先頭 `78 9c` = zlib ヘッダ、末尾4バイト = Adler32 | 211 bytes |
| 5. subarray(2, -4) | zlibヘッダ(2)とAdler32(4)を除去 → **raw deflate** | **205 bytes** |

**圧縮率: JSON 585B → msgpack+zlib 205B = 35%（65%削減）**

**HTTPリクエストヘッダ（実機検証済み）:**
```
POST /b2/p/new?checkonly HTTP/1.1
Content-Type: application/x-msgpack; charset=x-user-defined
Content-Encoding: deflate
Cookie: {B2クラウドセッションCookie群}

[raw deflate bytes, 205 bytes]
```

**HTTPレスポンス（実機検証済み）:**
```
HTTP/1.1 200 OK
Content-Type: application/json;charset=UTF-8

{"feed":{"title":"Error","entry":[{"shipment":{...},"error":[...]}]}}
```

**★重要: レスポンスは常にJSON（リクエスト形式に関わらず）。** msgpackで送ってもJSONで返る。つまり送信時のみmsgpack処理が必要で、受信側のf2a/e2a逆変換は不要。

**TS実装での簡略化:**
`pako.deflateRaw` は最初から raw deflate（zlibヘッダ/Adler32なし）を出力するため、元JSの `subarray(2, length - 4)` の手動除去ステップは**不要**になる。詳しい`compressFeed`実装は 2-3-5 参照。

**実機検証で得られた重要な事実:**
1. msgpack+zlibとJSONの両パスでレスポンスボディが**完全一致**
2. レスポンスContent-Typeは両パス共通で `application/json;charset=UTF-8`
3. エラー時のレスポンス構造も両パス共通
4. **100件一括でもJSON 98KB→5ms（f2a+msgpack+zlibの合計）で圧縮完了**、msgpackペイロードはわずか **1.6KB**（JSON比1.6%、付録D参照）

### 2-3-4. B2クラウドJSの2つのHTTPクライアント

| クラス | 用途 | 使用箇所 |
|-------|------|---------|
| `$.b2fetch` | シングルトンjQueryプラグイン。通常操作用 | 16箇所 |
| `MPUploader` | 独立インスタンス。大量一括操作用（`&multi`パラメータ付き） | 10箇所 |

**中身は完全に同一処理。** MPUploaderは並列リクエスト用の独立インスタンスを生成する。

### 2-3-5. 圧縮パイプライン（元JS→TS直接移植）

```javascript
// main-9d4c7b2348.js内 MPUploader.prototype.post/put/delete
var s = this.template;                              // /b2/d/_settings/template（1115行）
var o = f2a(s, e.data);                             // feed → 配列変換（t2m+e2a再帰）
var E = zlib_asm.compress(msgpack.encode(o));        // msgpack → zlib
var _ = new Uint8Array(E.subarray(2, E.length - 4)); // ヘッダ2byte/フッタ4byte除去
xhr.setRequestHeader("Content-Type", "application/x-msgpack; charset=x-user-defined");
xhr.setRequestHeader("Content-Encoding", "deflate");
xhr.send(_);
```

**TS実装:**
```typescript
// src/msgpack.ts
import { encode } from '@msgpack/msgpack';
import { deflateRaw } from 'pako';

export function compressFeed(template: string[], feedData: FeedData): Uint8Array {
  const mapping = t2m(template);     // テンプレート→マッピング辞書
  const array = f2a(mapping, feedData); // feed→配列変換
  const packed = encode(array);      // msgpackエンコード
  const compressed = deflateRaw(packed); // zlib圧縮（pako.deflateRaw = ヘッダ/フッタなし）
  return compressed;
}
```

**注意:** 元JSは`zlib_asm.compress`でzlib形式にしてからヘッダ2byte+フッタ4byteを手動除去しているが、pakoの`deflateRaw`は最初からrawフォーマット（ヘッダ/フッタなし）を出力するため、除去処理は不要。

### 2-3-6. 元JS関数群（移植対象）

**`f2a(template, feedData)`** — feed全体を配列に変換:
```javascript
function f2a(e,t){
  for(var _=[],n=0;n<15;n++)_[n]=null;
  var i=t2m(e);
  _[14]=[];
  for(var n=0;n<t.feed.entry.length;n++)
    _[14][n]=e2a(i,"entry",t.feed.entry[n]);
  return "updated"in t.feed&&(_[13]=t.feed.updated),_
}
```

**`e2a(mapping, key, entry)`** — 再帰的にentryを配列化:
```javascript
function e2a(e,t,_){
  var n=[];
  for(var i in _)
    if("object"==typeof _[i])
      if("undefined"!=typeof _[i].length&&_[i].length){
        for(var r=[],a=0;a<_[i].length;a++)r[a]=e2a(e[t],i,_[i][a]);
        n[e[t][i]._[0]]=r
      }else n[e[t][i]._[0]]=e2a(e[t],i,_[i]);
    else e[t][i]&&(void 0!=_[i]?n[e[t][i]._[0]]=B2GLOBAL.replaceControlCode(_[i]):n[e[t][i]._[0]]="");
  var a=0;
  for(var s in e[t])"_"!=s&&(void 0==n[a]&&(n[a]=null),a++);
  return n
}
```

**`t2m(templateLines)`** — テンプレート文字列→マッピング辞書:

**★ 重要（実機検証で確定）:** 配列の先頭 `author{}` の子要素 3つ（`name`, `uri`, `email`）は**先頭スペース付き**で書かなければならない。スペース無しで書くと子要素扱いではなくトップレベル扱いとなり、entry の配列インデックスが 3 個ズレる（shipment が idx 28 → idx 31 になってしまう）。
```javascript
function t2m(e){
  for(var t=["author{}"," name"," uri"," email","category{}"," ___term"," ___scheme",
    " ___label","content"," ___src"," ___type"," ______text","contributor{}",
    " name"," uri"," email","id","link{}"," ___href"," ___rel"," ___type",
    " ___title"," ___length","published","rights","rights____type","summary",
    "summary____type","title","title____type","subtitle","subtitle____type","updated"],
    _=t,n=0;n<e.length;n++) e[n].length>0&&_.push(e[n]);
  for(var i={entry:{}},r=0,n=0;n<_.length;n++){
    var a=_[n].replace(FIELD_PATTERN,"$2"),
        s=_[n].replace(FIELD_PATTERN,"$1").length,
        o=_[n].replace(/^\s+|\[\]|{}|!|\s+$/g,"");
    0==s&&(i.entry[a]=t2m2(_,n,o)[a],i.entry[a]._=[],i.entry[a]._[0]=r,i.entry[a]._[1]=o,r++)
  }
  return i
}
```

**`t2m2(lines, startIdx, path)`** — t2mの再帰ヘルパー（ネスト構造処理）:
```javascript
function t2m2(e,t,_){
  var n={},
      i=e[t].replace(FIELD_PATTERN,"$2"),
      r=e[t].replace(FIELD_PATTERN,"$1").length,
      a=0,
      s=e.length;
  n[i]={};
  for(var o=t+1;o<s;o++){
    var E=e[o].replace(FIELD_PATTERN,"$2"),
        l=e[o].replace(FIELD_PATTERN,"$1").length;
    if(l==r+1){
      var c=_+"."+e[o].replace(/^\s+|\[\]|{}|\s+$/g,"");
      n[i][E]=t2m2(e,o,_)[E],
      n[i][E]._=[],
      n[i][E]._[0]=a,
      n[i][E]._[1]=c,
      a++
    } else if(l<=r) return n
  }
  return n
}
```

### 2-3-7. 定数（FIELD_PATTERN, CONTROL_CODE）

**FIELD_PATTERN** — テンプレート行のパース用正規表現:
```javascript
FIELD_PATTERN = /^( *)([a-zA-Z_$][0-9a-zA-Z_$.]*)(?:\(([a-zA-Z$]+)\))?((?:\[([0-9]+)?\]|\{([\-0-9]*)~?([\-0-9]+)?\})?)(\!?)(?:=(.+))?$/
```

**キャプチャグループの意味:**
- `$1` = 先頭スペース（階層レベル判定用）
- `$2` = フィールド名
- `$3` = 型ヒント（`rdb_double`, `rdb_int`, `rdb_date`, `rdb_ignore`等、カッコ内）
- `$4` = 配列記法全体（`[]`, `[3]`, `{}`, `{0~5}` 等）
- `$8` = 必須フラグ（`!`）
- `$9` = デフォルト値（`=` 以降）

**CONTROL_CODE** — 制御文字除去用正規表現:
```javascript
CONTROL_CODE = /[\x00-\x08\x0b\x0c\x0d\x0e\x0f\x1a\x1b\x1c\x1d\x1e\x1f\x10-\x19\x7f]/g
```

**replaceControlCode** — 制御文字除去:
```javascript
B2GLOBAL.replaceControlCode = function(e) {
  return void 0 === e || null === e ? "" : e.replace(new RegExp(CONTROL_CODE), "")
}
```

### 2-3-8. B2クラウドJS内の2つのcheckonly関数

| 関数 | クラス | 用途 |
|------|--------|------|
| `shipmentErrorCheck` | `$.b2fetch` | 1件ずつ発行のバリデーション |
| `shipmentErrorCheck_MsgPack` | `MPUploader` | 外部データ一括インポートのバリデーション |
| `shipmentErrorCheck_ConfirmIssue` | `MPUploader` | 確認＋発行（`?checkonly&confirm_issue`） |

**全て同じ`/b2/p/new?checkonly`エンドポイント。** クラスが異なるだけで、圧縮パイプラインは共通。

### 2-4. TypeScript型定義（`src/types.ts`）

実装時の型定義リファレンス。全58+フィールドをカバー。

```typescript
// src/types.ts

/**
 * B2クラウド shipment (伝票) 完全フィールド型定義（実機確定）
 * msgpackパイプラインとの一貫性のため、全フィールド string 型で管理する。
 * サーバー自動補完フィールド（checked_date等）は Readonly 扱い。
 */
export interface Shipment {
  // === 基本フィールド (58個) ===
  service_type: ServiceType;
  is_cool: '0' | '1' | '2';
  shipment_date: string;              // "YYYY/MM/DD"
  short_delivery_date_flag: '0' | '1';
  is_printing_date: '0' | '1';
  delivery_time_zone: string;          // 6-2-T参照（タイムは "0010"/"0017"）
  shipment_number?: string;
  invoice_code: string;                // お客様コード10桁
  invoice_code_ext: string;            // ★空文字が正解
  invoice_freight_no: string;          // "01"等、運賃管理番号
  invoice_name?: string;
  package_qty: string;                 // "1"〜"99"
  is_printing_lot: '1' | '2' | '3';
  is_agent: '0' | '1';
  payment_flg: '0' | '1';
  consignee_telephone_display: string;
  consignee_telephone_ext?: string;
  consignee_zip_code: string;
  consignee_address1: string;
  is_using_center_service: '0' | '1';
  consignee_address2: string;
  consignee_address3: string;
  consignee_address4?: string;
  consignee_department1?: string;
  consignee_department2?: string;
  consignee_name: string;
  consignee_title?: string;            // "様" / "御中" / ""
  consignee_name_kana?: string;        // 半角カタカナのみ
  consignee_code?: string;
  shipper_telephone_display: string;
  shipper_telephone_ext?: string;
  shipper_zip_code: string;
  shipper_address1: string;
  shipper_address2: string;
  shipper_address3: string;
  shipper_address4?: string;
  shipper_name: string;
  shipper_title?: string;
  shipper_name_kana?: string;
  shipper_code?: string;
  item_code1?: string;
  item_name1: string;                  // DM(3)のみ不要
  item_code2?: string;
  item_name2?: string;
  handling_information1?: string;
  handling_information2?: string;
  note?: string;
  is_using_shipment_email: '0' | '1';
  is_using_delivery_email: '0' | '1';
  closure_key?: string;                // 複数口(6)必須
  search_key_title1?: string;
  search_key1?: string;
  search_key_title2?: string;
  search_key2?: string;
  search_key_title3?: string;
  search_key3?: string;
  search_key_title4?: string;
  search_key4?: string;                // ★追跡番号取得用ユニークキー

  // === 発行時メタ情報 ===
  shipment_flg?: '0' | '1';            // "0"=保存, "1"=発行
  printer_type?: '1' | '2' | '3';      // メタ情報（PDF出力には影響なし）

  // === オプションフィールド ===
  consignee_center_code?: string;       // is_using_center_service=1時必須
  amount?: string;                      // service_type=2,9 時必須（"1"〜"300000"）
  delivery_date?: string;               // is_printing_date=1 + short_delivery_date_flag=0 時必須
  payment_number?: string;
  notification_email_address?: string;
  direct_delivery_type?: string;
  cooperation_number?: string;

  // === メール送信系 ===
  shipment_email_address?: string;
  shipment_message?: string;
  delivery_email_address?: string;
  delivery_message?: string;
  is_using_shipment_post_email?: '0' | '1';
  shipment_post_email_address?: string;
  shipment_post_message?: string;
  is_using_cons_deli_post_email?: '0' | '1';   // ★ネコポス(A)のみ有効
  cons_deli_post_email_address?: string;
  cons_deli_post_message?: string;
  is_using_shipper_deli_post_email?: '0' | '1'; // ★ネコポス(A)のみ有効
  shipper_deli_post_email_address?: string;
  shipper_deli_post_message?: string;

  // === 収納代行（is_agent=1 時、12項目すべて必須） ===
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

  // === 一括住所指定（個別 address1/2/3 の代替、サーバーで自動分割） ===
  consignee_address?: string;
  shipper_address?: string;

  // === サーバー自動補完（Readonly） ===
  readonly tracking_number?: string;   // 保存時: UMN形式、発行後: 12桁数字
  readonly checked_date?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly update_time?: string;
  readonly created_ms?: string;
  readonly creator?: string;
  readonly updater?: string;
  readonly creator_loginid?: string;
  readonly updater_loginid?: string;
  readonly input_system_type?: string;
  readonly sorting_code?: string;
  readonly sorting_ab?: string;
  readonly shipper_center_code?: string;
  readonly shipper_center_name?: string;
  readonly customer_code?: string;
  readonly customer_code_ext?: string;
  readonly is_previous_flg?: string;
  readonly desc_sort_key?: string;
  readonly shipmentdata_serch_key?: string;   // typo原文ママ
  readonly reissue_count?: string;
  readonly is_reissue?: string;
  readonly is_printing_logout?: string;
  readonly is_update_only_tracking_status?: string;
  readonly package_seq?: string;
  readonly is_route_delivery?: string;
  readonly display_flg?: string;
  readonly deleted?: string;
  readonly error_flg?: '0' | '9' | string;
}

export type ServiceType = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'A';
export type PrinterType = '1' | '2' | '3';
export type PrintType = 'm' | 'm5' | '0' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'A' | 'CP';
export type OutputFormat = 'a4_multi' | 'a5_multi' | 'label';

/**
 * feed構造（全リクエスト/レスポンスの共通ラッパー）
 */
export interface Feed<T = Shipment> {
  feed: {
    title?: string;                    // "Error" or issue_no
    subtitle?: string;                  // 期待件数
    updated?: string;
    entry: FeedEntry<T>[];
  };
}

export interface FeedEntry<T = Shipment> {
  id?: string;                         // "/0482540070-/new/UMN...,1"
  link?: Array<{ ___href: string; ___rel: string }>;
  shipment?: T;
  customer?: Customer;
  system_date?: { sys_date: string; sys_time: string };
  error?: B2Error[];
}

export interface B2Error {
  error_property_name: string;
  error_code: string;                  // "EF011001" 等
  error_description: string;
}

export interface Customer {
  customer_code: string;
  customer_code_ext?: string;
  customer_name: string;
  customer_center_code?: string;
  sorting_code?: string;
  login_username?: string;
  eazy_cd?: string;
  is_kuroneko_yupacket?: string;
  invoice: InvoiceInfo[];
  access_token?: string;
}

export interface InvoiceInfo {
  invoice_code: string;
  invoice_code_ext: string;
  invoice_freight_no: string;
  invoice_name: string;
  is_collect?: string;
  is_using_credit_card?: string;
  is_receiving_agent?: string;
  is_using_qrcode?: string;
  is_using_electronic_money?: string;
  payment?: Array<{ payment_number: string }>;
}

/**
 * general_settings（プリンタ設定、4-1参照）
 */
export interface GeneralSettings {
  printer_type: PrinterType;            // "1"/"2"/"3"
  multi_paper_flg?: '1' | '2';
  is_tax_rate?: string;                 // "10" 等
  shipment_date_from?: string;
  shipment_date_to?: string;
  design_type_left?: '1' | '2' | '3' | '4';
  design_type_right?: '1' | '2';
  design_shipper_name_left?: string;
  design_shipper_name_right?: string;
  address1_left?: string;
  address2_left?: string;
  address3_left?: string;
  address1_right?: string;
  address2_right?: string;
  address3_right?: string;
  telephone_left?: string;
  telephone_right?: string;
  biko1_left?: string;
  biko2_left?: string;
  biko3_left?: string;
  biko1_right?: string;
  biko2_right?: string;
  biko3_right?: string;
  print_design_url?: string;
  [key: string]: any;                  // 他のサーバー自動設定フィールド
}

/**
 * Session — B2クラウドセッション状態（src/auth.ts）
 */
export interface Session {
  /** bmypageapi / bmypage / newb2web の3ドメインCookie管理（tough-cookie） */
  cookieJar: import('tough-cookie').CookieJar;

  /** B2クラウド動的URL（3-2で検出、ユーザーごとに異なる） */
  baseUrl: string;                      // 例: "https://newb2web.kuronekoyamato.co.jp"

  /** msgpack圧縮用テンプレート（3-4で取得、キャッシュ） */
  template: string[];                   // 1115行

  /** initdisplay経由で取得したお客様情報（3-5） */
  customer?: Customer;

  /** ログイン時刻（セッションタイムアウト判定用） */
  loginAt: number;

  /** プリンタ設定キャッシュ（PUT /settings の read-modify-write 用） */
  lastSettings?: Feed<GeneralSettings>;

  /** 認証情報（再ログイン用） */
  credentials: {
    customerCode: string;
    password: string;
    customerClsCode?: string;
    loginUserId?: string;
  };
}

/**
 * createAndPrint の戻り値
 */
export interface CreateAndPrintResult {
  issueNo: string;                     // "UMIN..."
  pdf: Buffer;                          // PDFバイナリ
  internalTracking: string;             // "UMN..."形式の内部ID
  trackingNumber: string;               // 12桁ヤマト追跡番号（未取得時は空文字）
}

/**
 * エラー型
 */
export class ValidationError extends Error {
  constructor(public errors: B2Error[]) {
    super(`Validation failed: ${errors.map(e => `${e.error_code}:${e.error_property_name}`).join(', ')}`);
  }
}

export class SessionExpiredError extends Error {
  constructor(message = 'Session expired, please re-authenticate') {
    super(message);
  }
}

export class B2ServerError extends Error {
  constructor(public status: number, public body: any, message?: string) {
    super(message || `B2 server error: ${status}`);
  }
}
```

---


## 3. 認証・ログインフロー

### 3-1. Step 1: ヤマトビジネスメンバーズ ログイン

```
POST https://bmypageapi.kuronekoyamato.co.jp/bmypageapi/login
Content-Type: application/x-www-form-urlencoded

Body:
  BTN_NM=LOGIN
  serviceType=portal
  CSTMR_CD={お客様コード}
  CSTMR_CLS_CD={枝番, 任意}
  CSTMR_PSWD={パスワード}
  LOGIN_USER_ID={個人ユーザーID, 任意}

Response: HTML
  成功判定: レスポンスに "ybmHeaderUserName" が含まれる
  失敗判定: "LNGERR" が含まれる
  → Set-Cookie ヘッダでセッションCookieが設定される
```

### 3-2. Step 2: B2クラウドサーバーURL動的検出 ★重要

```
POST https://bmypage.kuronekoyamato.co.jp/bmypage/ME0002.json
Content-Type: application/x-www-form-urlencoded
Cookie: {Step 1で取得したCookie}

Body: serviceId=06

Response (JSON):
{
  "accessible": "1",
  "serviceUrl": "https://newb2web.kuronekoyamato.co.jp/b2/d/_html/index.html?oauth&call_service_code=A",
  ...
}
```

**`serviceUrl`からホスト名を抽出:**
- `newb2web.kuronekoyamato.co.jp`
- `newb2web-s2.kuronekoyamato.co.jp`
- `newb2web-s3.kuronekoyamato.co.jp`
- 等（ユーザーごとに異なる）

### 3-3. Step 3: B2クラウドセッション確立

```
GET {serviceUrl}
Cookie: {Step 1で取得したCookie}

→ B2クラウドのセッションCookieが追加で設定される
→ 以降のAPIコールは {検出ホスト}/b2/p/... に対して行う
```

### 3-4. Step 4: テンプレート取得（msgpack圧縮用）★msgpackパス使用時のみ必須

**★ 重大な発見（Node.js E2E 検証で確定）: B2クラウドには2種類のテンプレートエンドポイントが存在し、用途が異なる。**

| エンドポイント | 内容 | 行数 | 用途 |
|-------------|------|-----|------|
| `/tmp/template.dat` | **base64エンコード**、フィールド名のみ（型ヒント除去済み） | **460行** | **★ 元JSの `___template` の実体、MPUploader の `f2a()` で使われる** |
| `/b2/d/_settings/template` | 生テキスト、型ヒント `(rdb_int)` 等付き | 1115行 | クライアント向け参照用。f2a には使えない（内容が別物） |

**元JS (main-9d4c7b2348.js) の実装:**
```javascript
var URL_GET_TEMPLATE = "/tmp/template.dat";  // ★こちらが正
var ___template;
$(function() {
  URL_GET_TEMPLATE.endsWith(".dat")
    ? $.b2fetch.base64Download({ url: URL_GET_TEMPLATE }).then(function(e) {
        e = atob(e);
        ___template = e.split("\n");
      })
    : $.b2fetch.get({ url: URL_GET_TEMPLATE }).then(function(e) {
        // .dat でない場合は括弧内の型ヒントを除去
        ___template = e.replace(/\((.*)\)/g, "").split("\n");
      });
});
```

**★ どちらの取得経路でも、f2a が期待するテンプレートは同一フォーマット（型ヒント除去済み、460行相当）になる。** 本プロジェクトでは **`/tmp/template.dat` (base64) を正として使用**する。

**正しい取得:**
```
GET {baseUrl}/tmp/template.dat
Cookie: {全Cookie}
Accept: application/base64
Origin: {baseUrl}
Referer: {baseUrl}/single_issue_reg.html

Response: テキスト（base64エンコード、約10KB）
  → atob() で復号 → '\n' split → 460行の文字列配列
```

**テンプレート行の記法（実体、型ヒント除去後）:**

| 記法 | 意味 | 例 |
|------|------|-----|
| 先頭スペース数 | 階層レベル（0=トップ、1=直下、2=孫…） | `shipment` / ` consignee_name` / `  value` |
| `{}` | 配列型（ネスト可能オブジェクト配列） | `entry{}` / `invoice{}` |
| `[]` | 配列型（インデックス付き固定長） | `payment[]` |
| `!` | 必須フィールドフラグ | `service_type!` |
| `=value` | デフォルト値 | `is_cool=0` |

注: **`/b2/d/_settings/template`** にある型ヒント `(rdb_int)`, `(rdb_date)`, `(rdb_double)`, `(rdb_ignore)` は `/tmp/template.dat` では既に除去されている。f2a/t2m は型ヒントを使わない。

**トップレベルエンティティ（entry 配下、全72個、idx 0-71）:**

最初の19個はAtomフィード仕様由来（author, category, content, contributor, id, link, published, rights, rights____type, summary, summary____type, title, title____type, subtitle, subtitle____type, updated）、残り53個はB2クラウド独自:
- idx=19: `general_settings`
- idx=20: `simple_default_display_info`
- idx=21: `shipment_email_message`
- idx=22: `delivery_email_message`
- idx=23: `consignee`
- idx=24: `shipper`
- idx=25: `content_details`
- idx=26: `import_pattern`
- idx=27: `package_size`
- idx=28: **`shipment`**（伝票本体、121フィールド）
- idx=29: `shipment_eazy`
- idx=30: `shipment_yupacket`
- idx=31: `shipment_today`
- idx=32: `tracking_number_list`
- idx=33-46: event_log, shipment_message_list, delivery_message_list, ..., error
- idx=47: `customer`
- idx=48: `system_date`
- ...
- idx=71: `client_access_info`

**★ テンプレートは msgpack パス使用時のみ必須**。JSON パスのみで実装する場合、取得不要（実装を単純化できる）。

### 3-5. セッション情報取得（initdisplay）

```
GET {baseUrl}/b2/d/initdisplay?service_no=interman&panel_id=single_issue_reg.html
Cookie: {全Cookie}

Response (JSON): 顧客情報、請求先、設定値などを含む
```

**取得できる重要データ:**
- `customer.customer_code` — お客様コード
- `customer.customer_name` — 顧客名（例: "株式会社レボル"）
- `customer.customer_center_code` — 顧客センターコード
- `customer.sorting_code` — 仕分けコード
- `customer.login_username` — ログインユーザー名
- `customer.lastlogin_date` — 最終ログイン日時
- `customer.eazy_cd` — EAZY利用可否（"1"=可）
- `customer.is_kuroneko_yupacket` — ゆうパケット利用可否（"1"=可）
- `customer.invoice[]` — 請求先配列
  - `invoice_code` — 請求先コード
  - `invoice_code_ext` — 請求先コード枝番
  - `invoice_freight_no` — 運賃管理番号
  - `is_collect` — コレクト利用可否
  - `is_using_credit_card` — クレジットカード利用可否
  - `is_receiving_agent` — 収納代行利用可否
  - `payment[].payment_number` — 支払番号
- `customer.access_token` — APIアクセストークン（例: "b14370defddafe62e31aaedcc28fcec1"）
- `system_date.sys_date` — システム日付
- `system_date.sys_time` — システム時刻

---

## 4. API仕様

### 4-1. エンドポイント一覧

全APIは `{baseUrl}/b2/p/` 以下。HTTPメソッドとクエリパラメータで操作を指定。

**Content-Type の実態（Node.js E2E検証で確定）:**
- **POST / PUT / GET:** `application/json`（`$.b2fetch` 互換、デフォルト）
- **DELETE:** **`application/x-msgpack; charset=x-user-defined` + `Content-Encoding: deflate` 必須**（4-11参照、JSON body では 409 または no-op）
- **大量一括オプション:** `useMsgpack: true` 明示指定で POST/PUT も msgpack+zlib に切替可能（MPUploader互換、5,000件でJSON比1-2%に圧縮）

| メソッド | パス | 操作 | body形式 |
|---------|------|------|---------|
| POST | `/b2/p/new?checkonly` | バリデーション | JSON |
| POST | `/b2/p/new` | 伝票保存 | JSON |
| GET | `/b2/p/new` | 保存済み伝票取得 | — |
| GET | `/b2/p/new?service_type-ne-1` | 保存済み全件（UI「保存分の発行」で使用） | — |
| **DELETE** | **`/b2/p/new`** | **保存済み伝票削除（1件〜多件一括）** | **★ msgpack+zlib 必須** |
| POST | `/b2/p/new?issue&print_type={pt}&sort1=service_type&sort2=created&sort3=created` | 新規印刷 | JSON |
| PUT | `/b2/p/history?reissue&print_type={pt}&sort1=service_type&sort2=created&sort3=created` | 再印刷 | JSON |
| GET | `/b2/p/polling?issue_no={no}&service_no=interman` | 印刷ポーリング | — |
| GET | `/b2/p/B2_OKURIJYO?checkonly=1&issue_no={no}` | **★ PDF準備完了 + 12桁追跡番号割当のトリガー（新規/再印刷必須）** | — |
| GET | `/b2/p/B2_OKURIJYO?issue_no={no}&fileonly=1` | PDF本体ダウンロード | — |
| GET | `/b2/p/history?all` | 全履歴取得 | — |
| GET | `/b2/p/history?all&tracking_number={tn}` | 追跡番号で検索 | — |
| GET | `/b2/p/history?all&search_key4={key}` | 検索キーで検索 | — |
| ~~PUT~~ | ~~`/b2/p/history?display_flg=0`~~ | ~~履歴削除（論理）~~ | **UI に機能無し、元JSに該当コードなし、API提供の有無未確認（4-11参照）** |
| **GET** | **`/b2/p/settings`** | **general_settings取得（★PDF出力形式を決める`printer_type`等）** | — |
| **PUT** | **`/b2/p/settings`** | **general_settings更新（read-modify-write必須）** | JSON |
| GET | `/tmp/template.dat` | テンプレート取得（base64、初回1回、3-4参照） | — |

**★ `/b2/p/settings` の重要フィールド:**

| フィールド | 値 | 意味 |
|-----------|-----|------|
| `general_settings.printer_type` | `"1"` / `"2"` / `"3"` | **PDFの中身を決定する最重要値**（1=レーザー, 2=インクジェット, 3=ラベルプリンタ） |
| `general_settings.multi_paper_flg` | `"1"` / `"2"` | 1=A5マルチ, 2=A4マルチ（`printer_type=1/2`時のみ有効） |
| `general_settings.is_tax_rate` | `"10"` 等 | 消費税率（PUT時必須、省略するとEF117002） |
| `general_settings.shipment_date_from` | `"YYYY/MM/DD"` | 発行済データ検索初期表示開始日（PUT時必須） |
| `general_settings.shipment_date_to` | `"YYYY/MM/DD"` | 発行済データ検索初期表示終了日（PUT時必須） |

**★ PUT `/b2/p/settings` の挙動:**
- **最小ペイロードは受け付けない**。`general_settings`オブジェクト全体を送信必須
- 欠落必須項目があると `EF117002`, `EF117003`, `EF117004` 等のエラー
- **必ず `GET /b2/p/settings` → 該当フィールドのみ変更 → PUT `/b2/p/settings`** の read-modify-write パターンで実装
- レスポンスの `feed.title === "Error"` でエラー判定

### 4-2. リクエスト/レスポンス共通構造

**★最小構成のリクエスト（実機確定、発払い(0)）:**
```json
{
  "feed": {
    "entry": [{
      "shipment": {
        "service_type": "0",
        "is_cool": "0",
        "shipment_date": "2026/04/20",
        "short_delivery_date_flag": "1",
        "is_printing_date": "1",
        "delivery_time_zone": "0000",
        "invoice_code": "0482540070",
        "invoice_code_ext": "",
        "invoice_freight_no": "01",
        "invoice_name": "",
        "package_qty": "1",
        "is_printing_lot": "2",
        "is_agent": "0",
        "payment_flg": "0",
        "consignee_telephone_display": "03-1234-5678",
        "consignee_zip_code": "100-0001",
        "consignee_address1": "東京都",
        "is_using_center_service": "0",
        "consignee_address2": "千代田区",
        "consignee_address3": "千代田1-1",
        "consignee_name": "テスト太郎",
        "consignee_title": "様",
        "shipper_telephone_display": "00482540070",
        "shipper_zip_code": "332-0015",
        "shipper_address1": "埼玉県",
        "shipper_address2": "川口市",
        "shipper_address3": "川口４－３－４０－２F",
        "shipper_name": "株式会社レボル",
        "item_name1": "サンプル",
        "is_using_shipment_email": "0",
        "is_using_delivery_email": "0",
        "search_key_title4": "API",
        "search_key4": "UNIQ20260416001"
      }
    }]
  }
}
```

**★ shipment 完全フィールドリスト（実機確定、58フィールド）:**

B2クラウドUIの `getIssueData()` 関数（`main-9d4c7b2348.js`内）が初期状態で返すshipmentオブジェクトの全フィールド。TS実装の `Shipment` 型定義はこれを基準とする。

| # | フィールド | 型 | デフォルト値 | 説明 |
|---|-----------|---|------------|------|
| 1 | `service_type` | string | `"0"` | サービス種別（0-9, A） |
| 2 | `is_cool` | string | `"0"` | クール便区分（0=普通/1=冷凍/2=冷蔵） |
| 3 | `shipment_date` | string | 当日 | 出荷予定日（YYYY/MM/DD） |
| 4 | `short_delivery_date_flag` | string | `"1"` | 最短日フラグ |
| 5 | `is_printing_date` | string | `"1"` | お届け日印字 |
| 6 | `delivery_time_zone` | string | `"0000"` | 配達時間帯 |
| 7 | `shipment_number` | string | `""` | 出荷番号（任意） |
| 8 | `invoice_code` | string | 自動 | お客様コード10桁 |
| 9 | `invoice_code_ext` | string | `""` | 請求先コード枝番（★空文字） |
| 10 | `invoice_freight_no` | string | `"01"` | 運賃管理番号（★枝番はここ） |
| 11 | `invoice_name` | string | `""` | 請求先表示名 |
| 12 | `package_qty` | string | `"1"` | 個数（1-99） |
| 13 | `is_printing_lot` | string | `"2"` | ロット印字区分 |
| 14 | `is_agent` | string | `"0"` | 収納代行区分 |
| 15 | `payment_flg` | string | `"0"` | 支払区分 |
| 16 | `consignee_telephone_display` | string | `""` | お届け先電話（表示用、ハイフン有り） |
| 17 | `consignee_telephone_ext` | string | `""` | お届け先電話内線 |
| 18 | `consignee_zip_code` | string | `""` | お届け先郵便番号 |
| 19 | `consignee_address1` | string | `""` | お届け先都道府県 |
| 20 | `is_using_center_service` | string | `"0"` | 営業所止めフラグ |
| 21 | `consignee_address2` | string | `""` | お届け先市区町村 |
| 22 | `consignee_address3` | string | `""` | お届け先町・番地 |
| 23 | `consignee_address4` | string | `""` | お届け先建物・部屋 |
| 24 | `consignee_department1` | string | `""` | お届け先部署1 |
| 25 | `consignee_department2` | string | `""` | お届け先部署2 |
| 26 | `consignee_name` | string | `""` | お届け先名 |
| 27 | `consignee_title` | string | `"様"` | お届け先敬称 |
| 28 | `consignee_name_kana` | string | `""` | お届け先カナ（半角） |
| 29 | `consignee_code` | string | `""` | お届け先コード |
| 30 | `shipper_telephone_display` | string | 自動 | 依頼主電話 |
| 31 | `shipper_telephone_ext` | string | `""` | 依頼主電話内線 |
| 32 | `shipper_zip_code` | string | 自動 | 依頼主郵便番号 |
| 33 | `shipper_address1` | string | 自動 | 依頼主都道府県 |
| 34 | `shipper_address2` | string | 自動 | 依頼主市区町村 |
| 35 | `shipper_address3` | string | 自動 | 依頼主町・番地 |
| 36 | `shipper_address4` | string | `""` | 依頼主建物・部屋 |
| 37 | `shipper_name` | string | 自動 | 依頼主名 |
| 38 | `shipper_title` | string | `""` | 依頼主敬称 |
| 39 | `shipper_name_kana` | string | `""` | 依頼主カナ |
| 40 | `shipper_code` | string | `""` | 依頼主コード |
| 41 | `item_code1` | string | `""` | 品名コード1 |
| 42 | `item_name1` | string | `""` | 品名1 |
| 43 | `item_code2` | string | `""` | 品名コード2 |
| 44 | `item_name2` | string | `""` | 品名2 |
| 45 | `handling_information1` | string | `""` | 荷扱い1 |
| 46 | `handling_information2` | string | `""` | 荷扱い2 |
| 47 | `note` | string | `""` | 記事 |
| 48 | `is_using_shipment_email` | string | `"0"` | 出荷予定メール送信 |
| 49 | `is_using_delivery_email` | string | `"0"` | 配達完了メール送信 |
| 50 | `closure_key` | string | `""` | 複数口くくりキー（service_type=6時必須） |
| 51 | `search_key_title1` | string | `""` | 検索キータイトル1 |
| 52 | `search_key1` | string | `""` | 検索キー1 |
| 53 | `search_key_title2` | string | `""` | 検索キータイトル2 |
| 54 | `search_key2` | string | `""` | 検索キー2 |
| 55 | `search_key_title3` | string | `""` | 検索キータイトル3 |
| 56 | `search_key3` | string | `""` | 検索キー3 |
| 57 | `search_key_title4` | string | `""` | 検索キータイトル4 |
| 58 | `search_key4` | string | `""` | 検索キー4（★追跡番号取得用ユニークキー） |
| 補 | `shipment_flg` | string | `"0"` or `"1"` | 保存=`"0"`、発行=`"1"` |

**★ 追加で送信可能なオプションフィールド（実機で確認済み）:**

| フィールド | 用途 |
|-----------|------|
| `shipment_email_address`, `shipment_message` | 出荷予定メール本文 |
| `delivery_email_address`, `delivery_message` | 配達完了メール本文 |
| `is_using_shipment_post_email`, `shipment_post_email_address`, `shipment_post_message` | 投函予定メール |
| `is_using_cons_deli_post_email`, `cons_deli_post_email_address`, `cons_deli_post_message` | お届け先向け投函完了メール |
| `is_using_shipper_deli_post_email`, `shipper_deli_post_email_address`, `shipper_deli_post_message` | 依頼主向け投函完了メール |
| `consignee_center_code` | お届け先営業所コード（is_using_center_service=1時） |
| `amount` | 代金引換額（service_type=2,9時） |
| `agent_amount`, `agent_tax_amount`, `agent_invoice_*`, `agent_request_*` | 収納代行12項目（is_agent=1時） |
| `delivery_date` | お届け予定日（is_printing_date=1+short_delivery_date_flag=0時必須） |
| `payment_number` | 支払番号 |
| `notification_email_address` | 通知メールアドレス |
| `direct_delivery_type` | 直接配達区分 |
| `cooperation_number` | 連携番号 |
| `printer_type` | 伝票メタ情報としてのプリンタ種別（`"1"`/`"2"`/`"3"`）。**PDF出力形式には影響しない**（出力形式は `general_settings.printer_type` が決定、5-3-2参照） |

**★ invoice_* フィールドの正しい組み合わせ（実機確定）:**

| フィールド | 値の例 | 説明 |
|-----------|-------|------|
| `invoice_code` | `"0482540070"` | お客様コード（10桁） |
| `invoice_code_ext` | `""` | **空文字が正解**（多くの場合） |
| `invoice_freight_no` | `"01"` | **運賃管理番号（枝番）はここ** |
| `invoice_name` | `""` | 請求先表示名（空OK） |

**★ 重要: Pythonコードやデフォルト入力で `invoice_code_ext` に枝番を入れがちだが、実際は `invoice_freight_no` に入れる。** `invoice_code_ext` が間違っているとES006002「請求先が存在しません」エラーになる。

**実際の値の取得方法:**
1. B2クラウドUIの `#select_invoice` オプションの表示テキスト `"0482540070-    01"` は `invoice_code` + `invoice_freight_no` を表示
2. initdisplay経由では取れない（Access denied）。ブラウザランタイムの `user_invoice[idx][0/1/2/3]` から取得するのがUIの方法
3. **TS実装では、初回ログイン時に `initdisplay` が通れば `customer.invoice[]` 配列から取得。通らない場合は環境変数から指定**

**レスポンス（checkonly成功、完全フィールド）:**
```json
{
  "feed": {
    "entry": [{
      "shipment": {
        "tracking_number": "UMN240309577",
        "shipment_date": "20260420",          ← "/"なしに正規化される
        "delivery_date": "20260421",          ← 最短日が自動補完
        "error_flg": "0",                     ← "0"=完全正常、"9"=警告あり正常
        "checked_date": "2026-04-16 11:49:59",
        "created_ms": "1776307799988",
        "input_system_type": "B2",             ← サーバー自動設定
        "sorting_code": "0196460",             ← サーバー自動設定
        "sorting_ab": "B",                      ← サーバー自動設定
        "shipper_center_code": "124594",       ← 依頼主の担当営業所
        "shipper_center_name": "川口飯塚営業所（川口飯塚）",
        "customer_code": "0482540070",
        "is_previous_flg": "1",
        "desc_sort_key": "9223370260546975819",
        "shipmentdata_serch_key": "00UMN240309577",
        ...
      },
      "customer": {                            ← entry内にcustomer情報も返る
        "customer_code": "0482540070",
        "customer_name": "株式会社レボル",
        "invoice": [{
          "invoice_code": "0482540070",
          "invoice_code_ext": "",
          "invoice_freight_no": "01",
          "invoice_name": "",
          "is_collect": "1",
          "is_using_credit_card": "02",
          "is_receiving_agent": "00"
        }],
        "access_token": "5e950e97a3f0e5a0d2fa7f599e50b152"
      },
      "system_date": { "sys_date": "20260416", "sys_time": "115000" },
      "link": [{ "___href": "/0482540070-/new/UMN240309577", "___rel": "self" }]
    }]
  }
}
```

**★ サーバー自動補完フィールド（保存時に追加される）:**

| フィールド | 例 | 説明 |
|-----------|-----|------|
| `checked_date` | `"2026-04-16 11:49:59"` | バリデーション実行日時 |
| `created` / `updated` / `update_time` | `"2026-04-16 11:49:59"` | 作成・更新日時 |
| `created_ms` | `"1776307799988"` | Unix時刻ミリ秒 |
| `creator` / `updater` | `"0482540070-"` | 作成者ID |
| `creator_loginid` / `updater_loginid` | `""` | ログインID |
| `input_system_type` | `"B2"` | 入力システム種別 |
| `sorting_code` | `"0196460"` | 仕分コード（依頼主側） |
| `sorting_ab` | `"B"` | 仕分AB区分 |
| `shipper_center_code` | `"124594"` | 担当営業所コード |
| `shipper_center_name` | `"川口飯塚営業所（川口飯塚）"` | 担当営業所名 |
| `customer_code` / `customer_code_ext` | `"0482540070"` | 顧客コード |
| `is_previous_flg` | `"1"` | 前回履歴フラグ |
| `desc_sort_key` | `"9223370260546975819"` | 降順ソート用キー |
| `shipmentdata_serch_key` | `"00UMN240309577"` | 検索用キー（typo注意: serchは原文ママ） |
| `reissue_count` | `"0"` | 再発行回数 |
| `is_reissue` | `"0"` | 再発行フラグ |
| `is_printing_logout` | `"0"` | ログアウト後印刷 |
| `is_update_only_tracking_status` | `"0"` | 追跡状態のみ更新フラグ |
| `package_seq` | `"1"` | パッケージ連番 |
| `is_route_delivery` | `"0"` | ルート配送フラグ |
| `display_flg` | `"1"` | 表示フラグ（0=論理削除） |
| `deleted` | `"0"` | 削除フラグ |
| `error_flg` | `"0"` or `"9"` | エラーフラグ |

**レスポンス（エラー）:**
```json
{
  "feed": {
    "title": "Error",
    "entry": [
      {
        "shipment": { ... },
        "error": [
          {
            "error_property_name": "consignee_telephone_display",
            "error_code": "EF011001",
            "error_description": "お届け先電話番号が入力されていません。"
          }
        ],
        "customer": { ... },
        "system_date": { "sys_date": "20260416", "sys_time": "093200" }
      }
    ]
  }
}
```

**複数伝票一括時:** `feed.title = "Error"` は1件でもエラーがあればError。各entryに独立したerror配列があるため、個別にどのエントリがNGか判別可能。

### 4-3. checkonly後のデータフロー

```
1. POST /new?checkonly
   └→ サーバーがshipmentを自動補完（checked_date, is_printing_lot等を追加）
   └→ error_flg="0" = 完全正常（エラーなし・警告なし）
   └→ error_flg="9" = 警告あり正常（処理継続可能）

2. 補完されたデータに shipment_flg="0" を追加

3. POST /new
   └→ 伝票が保存される
   └→ tracking_number = "UMN..." 形式の内部管理番号
```

**★ `error_flg` の値の意味（実機確定）:**

| 値 | 意味 | 処理継続 |
|----|------|:-------:|
| `"0"` | 完全正常（エラー・警告なし） | ✅ |
| `"9"` | 警告あり正常（注意事項が `error` 配列に返るが保存・発行可能） | ✅ |
| その他 | エラー | ❌ |

**`feed.title = "Error"` の判定:** `feed.title` が `"Error"` の場合のみエラー扱い。`feed.title` が未定義（undefined）なら成功。

### 4-4. print issueのentry構造（最重要）

**★ `POST /new?issue` リクエストのentry構造は厳密に規定されている:**

```json
{
  "feed": {
    "entry": [
      {
        "id": "/0482540070-/new/UMN240309577,1",       ← ★必須、末尾に",{revision}"
        "link": [                                         ← ★必須
          {"___href": "/0482540070-/new/UMN240309577", "___rel": "self"}
        ],
        "shipment": {
          /* 保存時のshipment全フィールド */,
          "shipment_flg": "1",                          ← ★"1"に変更（発行指示）
          "printer_type": "1"                            ← ★プリンタ種別
        }
      }
    ]
  }
}
```

**組み合わせ別の挙動（実機テスト済み）:**

| 構造 | 結果 |
|------|------|
| `id` + `link` 両方 | ✅ 200 OK（issue_no払い出し） |
| `id` のみ | ❌ 409 Conflict |
| `link` のみ | ❌ 500 Server Error |
| `id`も`link`もなし | ❌ 500 Server Error |
| `id` に `,{revision}` なし | ❌ 500 Server Error |

**idフォーマット:** `{link.___href},{revision}`
- 新規（保存直後）: `{customerCode prefix}/new/{trackingNumber},{revision}`
- 発行済み（再印刷時）: `{customerCode prefix}/history/{trackingNumber},{revision}`
- 最初の保存では revision=1

### 4-5. PDF取得の「2段構え」★実装上最重要

PDFと追跡番号の取得は**別ルート**。これを理解しないと実装できない。

```
┌─────────────┐     ┌──────────────────┐     ┌────────────┐
│ print_issue  │──→  │ issue_no取得      │──→  │ PDF取得     │ ← ルート①（即座）
│ POST /new?issue │  │ "UMIN0001077958" │     │ 106KB PDF  │
└─────────────┘     └──────────────────┘     └────────────┘
       │
       │（非同期でB2内部処理）
       ▼
┌─────────────────┐     ┌──────────────────────┐
│ search_history   │──→  │ 追跡番号(12桁)取得     │ ← ルート②（遅延あり）
│ search_key4検索  │     │ "389711074012"        │
└─────────────────┘     └──────────────────────┘
```

**ルート① PDF取得（即座に可能）:**
```
1. POST /b2/p/new?issue&print_type=m5&sort1=service_type&sort2=created&sort3=created
   Body: {"feed":{"entry":[{id, link, shipment}]}}  ← 上記4-4参照
   → {"feed":{"title":"UMIN0001077958","subtitle":"100"}}
     title = issue_no, subtitle = 期待件数

2. GET /b2/p/polling?issue_no=UMIN0001077958&service_no=interman
   → {"feed":{"title":"Success"}} まで繰り返し
   → 実機計測: 1回目で即Success取得（伝票1件の場合）

3. GET /b2/p/B2_OKURIJYO?checkonly=1&issue_no=UMIN0001077958
   → 200 OK（空bodyも成功）/ 4xx 5xx ならリトライ

4. GET /b2/p/B2_OKURIJYO?issue_no=UMIN0001077958&fileonly=1
   → PDF本体（106KB, %PDF-ヘッダ付き）
   → 96Bの短いHTML（sys_err.html redirect）が返った場合はエラー
```

**★ PDFエラーレスポンス判別:**
```
成功: ファイル先頭4バイト = 0x25 0x50 0x44 0x46 ("%PDF")
失敗: HTML `<script>parent.location.href = "/sys_err.html"</script>` (96バイト)
```

**ルート② 追跡番号取得（リトライ必須）:**
```
GET /b2/p/history?all&search_key4={ユニークキー}
→ shipment.tracking_number = "389711074012"（ヤマト12桁追跡番号）
```

**★search_key4のユニークキーが必須な理由:**
印刷でIDもtracking_numberも完全に変わる。保存時のID（`UMN240228236`）では印刷後の伝票を追跡できない。search_key4にユニークキーを事前設定しておくことで、印刷後もsearch_historyで特定できる。

**★リトライロジック:**
実機では **18回リトライ（約18秒）で取得成功** したケースあり。即時取れるケースもある。**推奨: 最大30回、1秒間隔でリトライ**。

**実機E2E完走結果:**
| Step | 値 | 所要時間 |
|------|------|---------|
| checkonly | error_flg="0" | ~60ms |
| save | tracking_number="UMN240309577" | ~200ms |
| get saved | search_key4で特定 | ~100ms |
| print issue | issue_no="UMIN0001077958" | ~300ms |
| polling | Success (1回目) | ~500ms |
| PDF checkonly | 200 OK | ~200ms |
| PDF download | 106KB %PDF | ~300ms |
| tracking取得 | 389711074012 (18回retry) | ~18秒 |
| **合計** | — | **~20秒** |

### 4-6. IDの変遷

```
保存時:  id = "/0482540070-/new/UMN240309577,1"
         tracking_number = "UMN240309577"          ← 内部管理番号

発行後:  id = "/0482540070-/history/389711074012,1"
         tracking_number = "389711074012"           ← ヤマト追跡番号（12桁数字）
```

**IDフォーマット:** `/{customerCode}-/{new|history}/{trackingNumber},{revision}`

印刷でIDもtracking_numberも完全に変わるため、保存時のIDでは印刷後の伝票を追跡できない。

### 4-7. 再印刷フロー

```
PUT /b2/p/history?reissue&print_type=m5  ← POSTではなくPUT
→ issue_no取得
→ polling → PDF download
```

**★ `B2_OKURIJYO?checkonly=1` は新規印刷でも再印刷でも必須（Node.js E2E検証で確定、2026-04-16）**

| ステップ | 新規印刷(issue) | 再印刷(reissue) |
|---------|:-------------:|:-------------:|
| 1. polling → Success | ✅ 必要 | ✅ 必要 |
| 2. `GET B2_OKURIJYO?checkonly=1&issue_no=...` | **★必須** | **★必須** |
| 3. `GET B2_OKURIJYO?issue_no=...&fileonly=1` | ✅ | ✅ |

**実測値（3件×2条件=6件で確認）:**

| 条件 | 結果 |
|------|------|
| 新規、`checkonly=1` **なし** → `fileonly=1` | **0/3 全滅**、96BのHTMLエラー `<script>parent.location.href="/sys_err.html"</script>` |
| 新規、`checkonly=1` **あり** → `fileonly=1` | **3/3 成功**、106KB前後のPDF返却 |

**★ PDF取得は `tracking_number`（12桁数字）割当の必須トリガー（2026-04-16 確定）**

`POST /new?issue` → polling Success の時点では `tracking_number` はまだ内部番号（`UMN...` で始まる13桁）。**`B2_OKURIJYO?checkonly=1` + `fileonly=1` の PDF 取得フローを通ることで、はじめて本番の 12桁数字の tracking_number がサーバー側で割り当てられ、`search_key4` による history 検索で取得可能になる**。

**実測値（仮説検証、各3件）:**

| 条件 | polling Success 後の動作 | `search_key4` → 12桁追跡番号 |
|------|------------------------|------------------------------|
| A: PDF取得**なし** | polling 終了後そのまま history 検索 | **0/3 全滅**、30秒待っても取れない |
| B: PDF取得**あり** | `checkonly=1` → `fileonly=1` → history 検索 | **3/3 成功**、PDF取得後 **1.4〜2.6秒**で取得 |
| C: Aで取れなかった伝票に後から PDF取得 | 後から `checkonly=1` → `fileonly=1` | 1/3 は即時取得、2/3 は数秒後に反映 |

**推測される内部メカニズム:** `polling Success` は「印刷ジョブ処理完了」のシグナルで、UMN内部番号レベルまで確定。`B2_OKURIJYO?checkonly=1` が「本番ラベル印刷確定」のサーバー同期処理をトリガーし、この中で 12桁 tracking_number の正式割当が起きる。`fileonly=1` が PDF 本体を取得。

**実装上の留意点:**
- 新規/再印刷のどちらでも、**PDF取得は必ず `checkonly=1` → `fileonly=1` の2段階**
- `tracking_number` を取得する場合は **PDF取得後に 1〜3秒の遅延を挟んで `search_key4` で history 検索**
- `search_key4` の値制限は **16文字以内**、`_` などの特殊文字は避ける（ES002070 エラーを確認済）。英数字のみ推奨

**実装パターン:** `downloadPDF(session, issueNo)` 関数を共通化。**完全な実装は 4-8 参照**（`createAndPrint` / `reprintShipment` / `downloadPDF` が統一された階層で定義されている）。

### 4-8. 参考実装パターン（createAndPrint）

**関数階層（本設計書の実装モデル）:**

```
┌─────────────────────────────────────────────┐
│ printWithFormat (5-3-3)                      │  ← 高レベルAPI（output_format指定）
│   output_format: 'a4_multi'|'a5_multi'|'label'│
└────────────────┬────────────────────────────┘
                 │
         ┌───────┴──────┐
         │              │
    setPrinterType   selectPrintType
    (5-3-3 実装)      (5-3-3 実装)
         │              │
         ▼              ▼
┌─────────────────────────────────────────────┐
│ createAndPrint (4-8)    or   reprintShipment │  ← 中レベルAPI（伝票フロー）
│   新規伝票 7ステップ        既存tracking再印刷  │
└────────────────┬────────────────────────────┘
                 │
         ┌───────┴──────┐ 各ステップで使用
         ▼              ▼
┌─────────────────┐  ┌─────────────────┐
│ b2Post, b2Get   │  │ downloadPDF      │  ← 低レベルAPI
│ (4-9)            │  │ (4-7)            │
│ checkonly/save等 │  │ polling+pdf取得  │
└─────────────────┘  └─────────────────┘
         │              │
         └──────┬───────┘
                ▼
         b2Request (4-9) — msgpack/JSON, Cookie, リトライ
```

**createAndPrint 実装（新規伝票の完全フロー、内部で `downloadPDF` を呼ぶ）:**

```typescript
async function createAndPrint(
  session: Session,
  shipment: Shipment,
  printType: string = 'm5'
): Promise<CreateAndPrintResult> {
  // ★search_key4にユニークキーを設定（追跡番号取得に必須、半角英数字のみ）
  const uniqKey = 'API' + Date.now();
  shipment.search_key_title4 = 'API';
  shipment.search_key4 = uniqKey;

  // === Step 1: checkonly ===
  const checkRes = await b2Post(session, '/b2/p/new?checkonly', {
    feed: { entry: [{ shipment }] }
  });
  const checkedEntry = checkRes.feed.entry[0];
  if (checkedEntry.error?.length > 0) {
    throw new ValidationError(checkedEntry.error);
  }
  checkedEntry.shipment.shipment_flg = '0';

  // === Step 2: save ===
  const saveRes = await b2Post(session, '/b2/p/new', {
    feed: { entry: [checkedEntry] }
  });
  const savedEntry = saveRes.feed.entry[0];
  const internalTracking = savedEntry.shipment.tracking_number;  // "UMN..."
  // ★この時点で id も link も返ってくる

  // === Step 3: print issue (★id + link 両方必須) ===
  const printEntry = {
    id: savedEntry.link[0].___href + ',1',  // 末尾に ",{revision}" 必須
    link: savedEntry.link,                    // linkも必須
    shipment: {
      ...savedEntry.shipment,
      shipment_flg: '1',     // ★'1' = 発行指示
      printer_type: '1',      // メタ情報（PDF出力には影響なし、5-1参照）
    },
  };
  const printRes = await b2Post(
    session,
    `/b2/p/new?issue&print_type=${printType}&sort1=service_type&sort2=created&sort3=created`,
    { feed: { entry: [printEntry] } }
  );
  const issueNo = printRes.feed.title;  // "UMIN..."
  if (!issueNo || issueNo === 'Error') {
    throw new Error('Print issue failed: ' + JSON.stringify(printRes));
  }

  // === Steps 4-6: polling + PDF取得（共通ルーチンに委譲、4-7参照） ===
  const pdf = await downloadPDF(session, issueNo);

  // === Step 7: 12桁追跡番号取得（PDF取得が割当トリガー、1-3秒の遅延あり、最大30秒リトライ） ===
  let trackingNumber = '';
  for (let i = 0; i < 30; i++) {
    const hist = await b2Get(session, `/b2/p/history?all&search_key4=${encodeURIComponent(uniqKey)}`);
    const found = hist.feed?.entry?.find((e: any) => e.shipment?.search_key4 === uniqKey);
    if (found?.shipment?.tracking_number && /^\d{12}$/.test(found.shipment.tracking_number)) {
      trackingNumber = found.shipment.tracking_number;
      break;
    }
    await sleep(1000);
  }

  return { issueNo, pdf, internalTracking, trackingNumber };
}

/**
 * 既存発行済み伝票の再印刷（4-7 と 5-3-3 参照）
 */
async function reprintShipment(
  session: Session,
  trackingNumber: string,   // 12桁ヤマト追跡番号 or UMN形式内部ID
  printType: string = 'm5'
): Promise<Buffer> {
  // history からエントリ取得
  const hist = await b2Get(
    session,
    `/b2/p/history?all&tracking_number=${encodeURIComponent(trackingNumber)}`
  );
  const entry = hist.feed?.entry?.[0];
  if (!entry) throw new Error(`Shipment not found: ${trackingNumber}`);

  // PUT /history?reissue
  const body = { feed: { entry: [{
    id: entry.link[0].___href + ',' + (Number(entry.shipment.reissue_count || '0') + 1),
    link: entry.link,
    shipment: { ...entry.shipment, shipment_flg: '1', printer_type: '1' },
  }]}};
  const res = await b2Put(
    session,
    `/b2/p/history?reissue&print_type=${printType}&sort1=service_type&sort2=created&sort3=created`,
    body
  );
  const issueNo = res.feed?.title;
  if (!issueNo || issueNo === 'Error') {
    throw new Error('Reissue failed: ' + JSON.stringify(res));
  }

  // checkonly=1 は新規/再印刷どちらでも必須
  return downloadPDF(session, issueNo);
}
```

**`downloadPDF` 関数（4-7 で定義、新規印刷と再印刷の両方で共通利用）:**

```typescript
async function downloadPDF(session: Session, issueNo: string): Promise<Buffer> {
  // polling
  for (let i = 0; i < 40; i++) {
    const poll = await b2Get(session, `/b2/p/polling?issue_no=${issueNo}&service_no=interman`);
    if (poll.feed?.title === 'Success') break;
    await sleep(500);
    if (i === 39) throw new Error('Polling timeout');
  }

  // ★ checkonly=1 は新規/再印刷どちらでも必須（4-7 参照、Node.js E2E検証で確定）
  // これがサーバー側の「本番印刷確定 → tracking_number 12桁割当」のトリガー
  const cookieStr = await session.cookieJar.getCookieString(session.baseUrl);
  const chkRes = await fetch(`${session.baseUrl}/b2/p/B2_OKURIJYO?checkonly=1&issue_no=${issueNo}`, {
    headers: {
      Cookie: cookieStr,
      'User-Agent': UA,
      'Origin': session.baseUrl,
      'Referer': session.baseUrl + '/single_issue_reg.html',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  // checkonly=1 のレスポンスは空 or 短いHTMLが正常（内容は問わない、副作用が重要）
  if (chkRes.status >= 500) throw new Error(`PDF checkonly failed: ${chkRes.status}`);

  // PDF本体取得
  const pdf = await b2GetBinary(session, `/b2/p/B2_OKURIJYO?issue_no=${issueNo}&fileonly=1`);

  // 先頭4バイトで %PDF チェック（96バイトHTMLエラー判別、4-5参照）
  if (pdf[0] !== 0x25 || pdf[1] !== 0x50 || pdf[2] !== 0x44 || pdf[3] !== 0x46) {
    throw new Error('PDF download failed (got HTML error page, likely 96B sys_err.html)');
  }
  return pdf;
}
```

### 4-9. HTTPクライアント実装（`src/b2client.ts`）

`createAndPrint`内で呼び出している `b2Request`、`b2Get`、`b2GetBinary`、`b2Post`、`b2Put` などの実装リファレンス。**JSONデフォルト（msgpackはオプション）、Cookie自動管理、401/403再ログイン、5xxリトライを内包する。**

**★ 必須ヘッダ（実機検証で確定）:** B2クラウドサーバーは CSRF 対策として **Origin + Referer + X-Requested-With** をチェックしており、これらが欠けると **`417 Expectation Failed`** が返る。Node.js / Python などブラウザ外から呼ぶ場合は必ず以下を設定:

| ヘッダ | 値 | 必須? |
|-------|-----|:----:|
| `Origin` | `https://{baseUrl host}` 例: `https://newb2web.kuronekoyamato.co.jp` | **★必須** |
| `Referer` | `{baseUrl}/single_issue_reg.html` 等、有効な B2クラウド配下のページ | **★必須** |
| `X-Requested-With` | `XMLHttpRequest` | **★必須** |
| `User-Agent` | Chrome 互換の UA 文字列 | 推奨（一部環境で必須） |
| `Accept` | `application/json, text/plain, */*` | 推奨 |
| `Content-Type` | JSON時: `application/json`、msgpack時: `application/x-msgpack; charset=x-user-defined` | 必須 |
| `Content-Encoding` | msgpack時のみ: `deflate` | msgpack 時のみ必須 |
| `Cookie` | `tough-cookie` で管理された全 Cookie | 認証済みなら必須 |

```typescript
// src/b2client.ts
import { fetch, type RequestInit } from 'undici';
import { CookieJar } from 'tough-cookie';
import { encode } from '@msgpack/msgpack';
import { deflateRaw } from 'pako';
import { f2a } from './msgpack.js';
import type { Session, Feed } from './types.js';
import { SessionExpiredError, B2ServerError } from './types.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

export interface B2RequestOptions {
  useMsgpack?: boolean;                 // 明示指定時に msgpack+zlib で送信。未指定時: DELETE=true (必須)、POST/PUT=false (JSON)
  maxRetries?: number;                  // 5xxリトライ回数（デフォルト: 3）
  onReauthenticate?: (session: Session) => Promise<void>;  // 401/403時の再ログインコールバック
}

/**
 * B2クラウドAPIへの統一リクエスト関数
 * - デフォルトは JSON ($.b2fetch 互換、POST/PUT)
 * - DELETE は msgpack+zlib を自動強制 (元JS挙動、JSON body だと 409 or no-op、4-11参照)
 * - useMsgpack: true を明示指定すれば POST/PUT でも msgpack+zlib 送信可能 (大量一括時)
 * - 401/403 → onReauthenticate → リトライ
 * - 5xx → 指数バックオフリトライ
 * - Cookie / Origin / Referer / X-Requested-With 自動付与
 */
export async function b2Request<T = any>(
  session: Session,
  path: string,                         // "/b2/p/new?checkonly" 等
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: Feed | any,
  opts: B2RequestOptions = {}
): Promise<T> {
  const { maxRetries = 3, onReauthenticate } = opts;
  // ★ DELETE は元JSの挙動と一致させるため msgpack+zlib を強制（4-11参照、JSON body では 409 や no-op）
  // ★ GET はそもそも body が無いので無関係、POST/PUT はデフォルト JSON、ユーザーが明示的に useMsgpack 指定可能
  const useMsgpack = opts.useMsgpack ?? (method === 'DELETE');
  const url = session.baseUrl + path;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const cookieStr = await session.cookieJar.getCookieString(url);
      const init: RequestInit = {
        method,
        headers: {
          'Cookie': cookieStr,
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': UA,
          // ★CSRF対策: 以下3つが無いと 417 Expectation Failed
          'Origin': session.baseUrl,
          'Referer': session.baseUrl + '/single_issue_reg.html',
          'X-Requested-With': 'XMLHttpRequest',
        },
      };

      if (body !== undefined && method !== 'GET') {
        if (useMsgpack) {
          // msgpack+zlibパイプライン（2-3-5参照、MPUploader互換、DELETEはこちら必須）
          const arr = f2a(session.template, body);
          const packed = encode(arr);
          const compressed = deflateRaw(packed);
          (init.headers as any)['Content-Type'] = 'application/x-msgpack; charset=x-user-defined';
          (init.headers as any)['Content-Encoding'] = 'deflate';
          init.body = compressed;
        } else {
          // JSON パス（$.b2fetch.post 互換、デフォルト）
          (init.headers as any)['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
      }

      const res = await fetch(url, init);

      // Set-Cookie を cookieJar に保存
      const setCookies = res.headers.getSetCookie?.() ?? [];
      for (const sc of setCookies) {
        await session.cookieJar.setCookie(sc, url);
      }

      // 401/403 → 再ログイン試行
      if ((res.status === 401 || res.status === 403) && onReauthenticate && attempt === 0) {
        await onReauthenticate(session);
        continue;  // リトライ
      }

      // 5xx → 指数バックオフでリトライ
      if (res.status >= 500 && res.status < 600 && attempt < maxRetries) {
        await sleep(Math.min(1000 * Math.pow(2, attempt), 10000));
        continue;
      }

      // レスポンスは常に JSON（2-3-3参照）
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await res.json() as any;
        if (res.status >= 400) {
          throw new B2ServerError(res.status, json);
        }
        return json;
      } else {
        const text = await res.text();
        if (res.status >= 400) {
          throw new B2ServerError(res.status, text);
        }
        // 稀に JSON 以外が返る場合はそのまま文字列で返す
        return text as any;
      }
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxRetries && !(e instanceof B2ServerError && e.status < 500)) {
        await sleep(Math.min(1000 * Math.pow(2, attempt), 10000));
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('b2Request failed');
}

/**
 * バイナリ取得（PDF用、msgpack ではなく常に生バイト列返却）
 */
export async function b2GetBinary(session: Session, path: string): Promise<Buffer> {
  const url = session.baseUrl + path;
  const cookieStr = await session.cookieJar.getCookieString(url);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Cookie: cookieStr },
  });
  if (!res.ok) throw new B2ServerError(res.status, 'binary fetch failed');
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * 便利ラッパー関数
 */
export const b2Get = <T = any>(s: Session, p: string, o?: B2RequestOptions) =>
  b2Request<T>(s, p, 'GET', undefined, o);
export const b2Post = <T = any>(s: Session, p: string, b: any, o?: B2RequestOptions) =>
  b2Request<T>(s, p, 'POST', b, o);
export const b2Put = <T = any>(s: Session, p: string, b: any, o?: B2RequestOptions) =>
  b2Request<T>(s, p, 'PUT', b, o);
export const b2Delete = <T = any>(s: Session, p: string, b?: any, o?: B2RequestOptions) =>
  b2Request<T>(s, p, 'DELETE', b, o);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
```

**リトライ戦略サマリー:**

| 状況 | 対応 |
|------|------|
| 401 / 403 (未認証) | `onReauthenticate` コールバックを1回実行 → リトライ、失敗したら `SessionExpiredError` |
| 5xx (サーバーエラー) | 指数バックオフで最大3回リトライ（1s→2s→4s、上限10s） |
| ネットワーク例外 | 同じく指数バックオフリトライ |
| 4xx (クライアントエラー、401/403除く) | リトライせず即エラー |
| `feed.title === "Error"` | HTTPは200だがバリデーションエラー。`b2Request` は例外を投げず、呼び出し側で `feed.entry[0].error` を確認する |

**セッションのライフサイクル（2-2 の実装版）:**

```typescript
// src/auth.ts
import { CookieJar } from 'tough-cookie';
import type { Session } from './types.js';

export async function login(credentials: Session['credentials']): Promise<Session> {
  const cookieJar = new CookieJar();

  // Step 1: ヤマトビジネスメンバーズ ログイン（3-1）
  const step1Url = 'https://bmypageapi.kuronekoyamato.co.jp/bmypageapi/login';
  const step1Body = new URLSearchParams({
    BTN_NM: 'LOGIN',
    serviceType: 'portal',
    CSTMR_CD: credentials.customerCode,
    CSTMR_CLS_CD: credentials.customerClsCode || '',
    CSTMR_PSWD: credentials.password,
    LOGIN_USER_ID: credentials.loginUserId || '',
  });
  const r1 = await fetch(step1Url, {
    method: 'POST',
    body: step1Body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const html = await r1.text();
  if (!html.includes('ybmHeaderUserName')) {
    throw new Error('Login failed: ' + (html.includes('LNGERR') ? 'invalid credentials' : 'unknown'));
  }
  const setCookies1 = r1.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies1) await cookieJar.setCookie(sc, step1Url);

  // Step 2: serviceUrl検出（3-2）
  const step2Url = 'https://bmypage.kuronekoyamato.co.jp/bmypage/ME0002.json';
  const cookies2 = await cookieJar.getCookieString(step2Url);
  const r2 = await fetch(step2Url, {
    method: 'POST',
    body: 'serviceId=06',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies2,
    },
  });
  const { serviceUrl } = await r2.json() as any;
  const baseUrl = new URL(serviceUrl).origin;

  // Step 3: B2クラウドセッション確立（3-3）
  const r3 = await fetch(serviceUrl, {
    headers: { Cookie: await cookieJar.getCookieString(serviceUrl) },
  });
  const setCookies3 = r3.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies3) await cookieJar.setCookie(sc, serviceUrl);

  // Step 4: テンプレート取得（3-4）
  const templateUrl = `${baseUrl}/b2/d/_settings/template`;
  const r4 = await fetch(templateUrl, {
    headers: { Cookie: await cookieJar.getCookieString(templateUrl) },
  });
  const templateStr = await r4.text();
  const template = templateStr.split('\n');

  return {
    cookieJar,
    baseUrl,
    template,
    loginAt: Date.now(),
    credentials,
  };
}

/**
 * 401/403 時の自動再ログイン用
 */
export async function reauthenticate(session: Session): Promise<void> {
  const newSession = await login(session.credentials);
  session.cookieJar = newSession.cookieJar;
  session.baseUrl = newSession.baseUrl;
  session.template = newSession.template;
  session.loginAt = newSession.loginAt;
}
```

### 4-10. Node.js 環境での E2E 検証結果（2026-04-16 実施）

**環境:** Node.js v22.22.2 + `undici` ^6 + `tough-cookie` ^5 + `@msgpack/msgpack` ^3 + `pako` ^2.1。

**認証フロー（3-1〜3-4）のタイミング実測:**

| Step | 内容 | 所要時間 |
|------|------|---------|
| 1 | bmypageapi POST（302 → bmypage リダイレクト自動追従、最大5ホップ） | ~800ms |
| 2 | bmypage ME0002.json で `serviceUrl` 検出 | ~200ms |
| 3 | `serviceUrl` GET → authorize_b2 経由で newb2web に OAuth コード受け渡し（302×2） | ~1,500ms |
| 4 | **`/tmp/template.dat`** を GET → base64 デコード → 460行配列 | ~200ms |
| **合計** | — | **3〜5秒** |

**E2E フロー（checkonly → save → print → polling → PDF → tracking）のタイミング（JSON/msgpackほぼ同等）:**

| Step | タイミング | 備考 |
|------|-----------|------|
| [1] checkonly | ~250ms | サーバーがフィールド補完しecho back |
| [2] save | ~250ms | `tracking_number=UMN...` 返却 |
| [3] print | ~300ms | `issue_no=UMIN...` 返却 |
| [4] polling | ~900ms (2回) | `feed.title="Success"` まで待機 |
| [5] PDF download | ~190ms | 再印刷時は `checkonly=1` 事前コール必須 |
| [6] tracking 取得 | 可変（数秒〜30秒） | `/b2/p/history?all&search_key4=...` を retry |

**★ Node.js から呼ぶときの落とし穴（実機で踏んで解決）:**

1. **Origin + Referer + X-Requested-With が無いと `417 Expectation Failed`** — ブラウザからの fetch では自動付与されるが Node.js では手動
2. **テンプレートは `/tmp/template.dat` (base64)**、`/b2/d/_settings/template` (1115行) とは別物（後者は f2a に使えない）
3. **t2m の t 配列で `author{}` の子 3つは `" name"/" uri"/" email"` (先頭スペース付き)** — スペース無しで書くと entry 配列インデックスが3個ズレ、shipment の位置が idx 28 → 31 になる
4. **`$.b2fetch.post` は JSON を送っている**（設計書初期推定と逆）— msgpack+zlib は MPUploader（大量一括）専用
5. **302 リダイレクトは `redirect: 'manual'` で手動追跡** — fetch の自動リダイレクトだと Cookie が間で失われる
6. **`ignoreUndefined: true` など @msgpack/msgpack のオプションはデフォルトのままで可** — オプション違いでは結果は変わらない

**検証コード:** `/home/claude/b2test/` に残存（`src/msgpack-js.js`, `src/b2client.js`, `test-e1-auth.js`, `test-e2e.js` 等）

**追加の実機検証で解決済み（2026-04-16 追試）:**
- ✅ **PDF 96B HTMLエラーの原因判明** — 新規印刷でも **`B2_OKURIJYO?checkonly=1` の事前コールが必須**。3件×2条件の検証で 0/3→3/3 で確定。設計書 4-7 を「新規/再印刷どちらでも必須」に訂正済
- ✅ **12桁追跡番号の取得メカニズム判明** — `B2_OKURIJYO?checkonly=1 → fileonly=1` の PDF取得フロー自体が「本番印刷確定 → 12桁tracking_number割当」のサーバー側トリガー。PDF取得後 **1.4〜2.6秒で取得可能**（PDF取得なしでは 30秒待っても取れない）。`search_key4` は **16文字以内の英数字推奨**（19文字で ES002070 エラー）
- ✅ **401/403時の挙動確定（E-3 #9）** — Cookie無効時は HTTP **401** + body `{"feed":{"title":"Authentication error."}}`。`b2Request` で検知し `login()` 再実行・リトライで完全復旧を確認
- ✅ **DELETE /new の正しい仕様判明（E-4 #13）** — 詳細は 4-11 参照

### 4-11. DELETE フロー（E-4 #13, #14 検証結果、2026-04-16）

**ブラウザUI (save_issue_search.html) の「削除」ボタンを Playwright で押して元JSが送るリクエストを HARキャプチャし、以下の仕様を確定。**

#### DELETE /b2/p/new の正しい仕様

| 項目 | 値 |
|------|-----|
| URL | `/b2/p/new`（**クエリパラメータ不要**、`?force` も不要） |
| Method | `DELETE` |
| Content-Type | **`application/x-msgpack; charset=x-user-defined`** |
| Content-Encoding | **`deflate`**（raw deflate = zlib の 2byte header と 4byte footer を除去） |
| Body | **msgpack+zlib 圧縮された feed**（f2a → msgpack.encode → zlib_asm.compress → subarray(2, -4)） |
| Response | `{"feed":{"title":"Deleted.","entry":[{"system_date":{...}}]}}` |

#### 重要な発見

**✅ 一括削除が可能** — 19件の保存済み伝票を 1回の DELETE リクエストで全削除できた（HTTP 200、`"Deleted."` 応答、list反映確認済）。feed.entry[] に複数の shipment を入れて送信する。

**⚠️ JSON body では受け付けない** — 先行検証で JSON body で `DELETE /b2/p/new`, `DELETE /b2/p/new?force`, `DELETE /b2/p/edit?force` を試したところ:
- `/new?force` (JSON) → **409 Conflict**
- `/new/{UMN}?force` (JSON) → 200だが**実削除されず**
- `/edit?force` (JSON) → 200 `"Deleted."` だが**実削除されず**

つまり、**DELETE は msgpack+zlib パイプライン必須**。これは設計書 1-3 の「msgpack は大量一括専用」と一貫する（削除も内部的には「複数件バッチ処理」として設計されている）。

#### 実装パターン

```typescript
/**
 * 保存済み（未発行）伝票の削除
 * 1件〜複数件をまとめて削除可能（UI では19件同時削除を確認）
 */
async function deleteSavedShipments(
  session: Session,
  shipments: Array<{ umn: string, savedEntry: any }>
): Promise<void> {
  const body = {
    feed: {
      entry: shipments.map(({ savedEntry }) => ({
        id: savedEntry.link[0].___href,
        link: savedEntry.link,
        shipment: savedEntry.shipment,
      }))
    }
  };

  // ★ 必ず useMsgpack: true で DELETE する
  const res = await b2Request(session, '/b2/p/new', 'DELETE', body, { useMsgpack: true });
  if (res.feed?.title !== 'Deleted.') {
    throw new Error('Delete failed: ' + JSON.stringify(res));
  }
}
```

#### DELETE /history?display_flg=0（E-4 #14）— UI 上は機能無し

**ブラウザUI調査で判明**: B2クラウドの Web UI (`save_issue_search.html`, `history_issue_search.html`) には「発行済み履歴の削除」ボタンは存在しない。発行済み伝票は基本的に論理削除できないのが仕様。

**API 経由で `PUT /b2/p/history?display_flg=0` または shipment 単位で `display_flg=0` を set する PUT が動作するかは未確認**。実装時に必要になったら試験すること（元JSに該当コードが見つからないため、そもそもAPI提供されていない可能性が高い）。

---


## 5. 印刷システム

### 5-1. `shipment.printer_type`（伝票単位のプリンタ種別）

伝票ごとに指定する `printer_type` フィールド。**こちらは伝票にメタ情報として残るだけで、PDF出力形式には直接影響しない**（影響するのは `general_settings.printer_type`、5-3-2参照）。

| printer_type | 名称 | 用途 |
|-------------|------|------|
| `1` | レーザー | デフォルト。伝票のプリンタ種別メタ情報として記録 |
| `2` | インクジェット | 同上 |
| `3` | ラベルプリンタ | 同上 |

**★重要:** `shipment.printer_type` をcheckonlyでは受け付けるが、**保存時にサーバーが`"1"`に上書きする**ことがある（実機で確認）。一方、**PDF出力形式の決定はアカウント単位の `general_settings.printer_type` による**。混同しないこと。

### 5-2. print_type（用紙種別）— 完全マップ

**★ 重要:** サーバーが返すPDFは **3軸（`shipment.service_type` × `general_settings.printer_type` × `print_type`）** で決まる（詳細は 5-3、完全な挙動マトリクスは 5-3-2-B）。この節では `service_type=0` (発払い) 基準の簡易版マップのみ示す。

**5-2-A. レーザー/インクジェット設定 × service_type=0 基準:**

| print_type | 名称 | ページサイズ | PDFサイズ | 備考 |
|-----------|------|-----------|----------|------|
| `m` | A4マルチ | 210×297mm (A4縦) | 107,407B | 標準 |
| `m5` | A5マルチ | 210×149mm (A5横) | 107,394B | **唯一A4以外** |
| `0`/`2`/`4`/`5`/`8`/`9` | 各種専用紙 | 210×297mm | 107,407B | 全部A4フォールバック（service_type=0基準） |
| `3` | DM/ゆうメール | 210×297mm | ~56KB | |
| `7`/`A` | ネコポス・ゆうパケット | 210×297mm | ~100KB | |
| `CP` | 払込票 | — | ❌ 96B HTMLエラー | |

→ **`m5` 以外は A4フォールバック**（service_type=0 の場合）。ただし **service_type が違えば中身は別物**（5-3-1参照）。

**5-2-B. ラベルプリンタ設定時:**

→ **必ず 5-3-2-B の完全マトリクス**を参照。発払い(0)以外は挙動が全く違う（特にDM(3)/着払い(5)/コンパクト(8)/コンパクトコレクト(9)はラベル印刷**全面不可**）。

簡易版（service_type=0 基準の代表値）:

| print_type | MediaBox | PDFサイズ | 備考 |
|-----------|----------|----------|------|
| `m`/`0`/`8` | 326.551×561.543 (115.1×198.1mm) | 57,157B | 共通ラベル |
| **`4`** | **339.023×669.543 (119.6×236.1mm)** | **70,032B** | **★発払い専用ラベル（推奨）** |
| `3` | 317.480×204.094 (112×72mm) | 58,945B | DM小サイズ（※DM伝票自体はラベル不可、他service_typeで流用は可能だがレイアウト不一致） |
| `7`/`A` | 327.685×561.543 (115.6×198.1mm) | 72,801B | ネコポス/ゆうパケット共通 |
| `m5`/`5`/`6`/`9` | — | ❌ 400 Error | 全service_typeで非対応 |
| `CP` | — | ❌ polling timeout | |

**5-2-C. 設計方針:**

| ユースケース | 推奨設定 |
|------------|---------|
| A4レーザープリンタで通常印刷 | `general_settings.printer_type="1"`, `print_type="m"` |
| A5レーザーマルチ用紙 | `general_settings.printer_type="1"`, `print_type="m5"` |
| サーマルラベルプリンタで発払い・タイム | `general_settings.printer_type="3"`, `print_type="4"`（専用レイアウト）or `"m"`（共通レイアウト） |
| サーマルラベルプリンタでコレクト | `general_settings.printer_type="3"`, `print_type="2"` |
| サーマルラベルプリンタでネコポス | `general_settings.printer_type="3"`, `print_type="A"`（or `"7"`、同内容） |
| サーマルラベルプリンタでゆうパケット | `general_settings.printer_type="3"`, `print_type="7"` |
| **着払い(5)/コンパクト(8)/DM(3)/コンパクトコレクト(9)** | **ラベルプリンタ不可**、必ず `printer_type="1"` で `print_type="m"`（5-3-2-B参照） |

**★ JS定数の注記:**
- 元JSでは `PRINTER_PAPER_A4_MULTI_CD = "9"`（A4マルチ別レイアウト）と定義されているが、実機では`9`=コンパクトコレクトとして動作する。定数名と実際の値の意味がズレているため、定数名でなく実際の挙動を参照すること。

### 5-3. PDF出力の3軸ルール ★

**PDFの中身（MediaBox・streamLengths・バイナリ内容・ファイルサイズ）は、以下の3軸で決まる:**

| 軸 | 影響度 | 決定される要素 | 値 |
|---|:---:|---|---|
| ① `shipment.service_type` | **最大** | PDFのレイアウト・コンテンツ全体 | `0`（発払い）/ `4`（タイム）/ `5`（着払い）/ `8`（コンパクト）/ `A`（ネコポス）/ `7`（ゆうパケット）/ `3`（DM）/ `2`（コレクト）/ `6`（複数口）/ `9`（コンパクトコレクト）/ `1`（EAZY） |
| ② `general_settings.printer_type` | 大 | 用紙サイズ系（A4 or ラベル専用サイズ） | `"1"`（レーザー）/ `"2"`（インクジェット）/ `"3"`（ラベルプリンタ） |
| ③ `print_type`（クエリパラメータ） | 中 | 用紙レイアウト選択、整合性チェック、一部でバリエーション選択 | `m`/`m5`/`0`/`4`/`5`/`7`/`8`/`3`/`A`/`CP` 等 |

**APIからの利用方針:**
- **A4用途（通常印刷・画面確認）:** `general_settings.printer_type="1"` のままでOK
- **ラベル出力が必要:** `PUT /b2/p/settings` で `printer_type="3"` に切替後、service_typeに応じた`print_type`で印刷 → サーバーが**最終ラベルサイズのPDF**を直接返す（クライアント側でcrop/変換は不要）
- **並列運用時の注意:** `general_settings.printer_type` はアカウント単位のグローバル設定。同時に複数フォーマットで印刷したい場合は排他制御が必要（5-3-3参照）

**B2クラウド+クライアントアプリの役割:**
- サーバーが `printer_type` に応じた最終サイズのPDFを生成
- ローカルアプリ（`http://localhost:8102/`）はPDFをプリンタに送信するだけ
- レーザー設定時のマルチ用紙印刷では、クライアントアプリが「A4の何面を印刷するか」を管理

**ラベル余白設定（`general_settings` 内、ラベルプリンタ使用時のカスタマイズ用）:**

B2クラウドUIの「プリンタ・送り状レイアウト」セクションに表示される左右余白の印字内容を指定。`general_settings.design_type_left` / `design_type_right` に以下のコードを設定。

| 位置 | `general_settings` フィールド | コード | 名称 |
|------|------------------------------|-------|------|
| 左余白 | `design_type_left` | `1` | デザイン画像（`print_design_url`で指定した画像を印字） |
| 左余白 | `design_type_left` | `2` | ご依頼主控 |
| 左余白 | `design_type_left` | `3` | 出荷元情報 |
| 左余白 | `design_type_left` | `4` | 印字なし |
| 右余白 | `design_type_right` | `1` | お届け先控 |
| 右余白 | `design_type_right` | `2` | 出荷元情報 |

**関連する `general_settings` フィールド:**

| フィールド | 用途 |
|-----------|------|
| `design_type_left` / `design_type_right` | 左右余白の種別（上記コード） |
| `design_shipper_name_left` / `design_shipper_name_right` | 余白に表示する依頼主名 |
| `address1_left` 〜 `address3_left` / `_right` | 余白に表示する住所 |
| `telephone_left` / `telephone_right` | 余白に表示する電話番号 |
| `biko1_left` 〜 `biko3_left` / `_right` | 余白に表示する備考 |
| `print_design_url` | デザイン画像のURL（`design_type=1` 時） |

**余白設定を変更する場合も `PUT /b2/p/settings` の read-modify-write パターンが必須**（4-1参照）。

### 5-3-1. 軸① `service_type` の影響（実機確定）

**同じ `print_type=m` でも、service_type が違えば完全に別のPDF**が返る。

**レーザー設定(`printer_type=1`) × `print_type=m` 固定:**

| service_type | 名称 | サイズ | MediaBox | streamLengths | images |
|-------------|------|--------|----------|---------------|:------:|
| `0` | 発払い | 105,497B | 595×842 (A4縦) | [166,552,26196,573,25882] | 6 |
| `5` | 着払い | 91,769B | 595×842 (A4縦) | [166,767,35547,657,28326] | 3 |
| `8` | コンパクト | 119,448B | 595×842 (A4縦) | [166,611,29508,573,25882] | 6 |

→ MediaBoxは同じA4縦でも、**streamLengths・サイズ・画像数が全部違う = 完全に別コンテンツのPDF**。

**ラベルプリンタ設定(`printer_type=3`) × `print_type=m` 固定:**

| service_type | 名称 | サイズ | MediaBox | streamLengths | images |
|-------------|------|--------|----------|---------------|:------:|
| `0` | 発払い | 57,157B | 326.551×561.543 (115.1×198.1mm) | [166,646,27134,259,12851] | 0 |
| `5` | 着払い | 57,972B | 326.551×561.543 (同サイズ) | [166,665,28509,259,12851] | 0 |
| `8` | コンパクト | 73,628B | 326.551×561.543 (同サイズ) | [166,661,28285,377,17492] | 1 |

→ ラベル用でもservice_type別に内容が違う。コンパクトだけimages=1（専用ロゴ含む）。

### 5-3-2. 軸② × ③ `printer_type` × `print_type` の組み合わせ（実機確定）

**5-3-2-A. `printer_type="1"` or `"2"` (レーザー/インクジェット) 時:**

`service_type=0` (発払い)の伝票固定で print_type を変えた結果:

| print_type | 名称 | サイズ | MediaBox | streamLengths |
|-----------|------|--------|----------|---------------|
| `m` | A4マルチ | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |
| `m5` | A5マルチ | 107,394B | 595×421pt (A5横) | [166,563,26528,631,26576] |
| `0` | 発払い専用紙 | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |
| `4` | ラベル(発払い) | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |
| `5` | ラベル(コレクト) | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |
| `8` | ラベル(コンパクト) | 107,407B | 595×842pt (A4縦) | [166,563,26528,631,26576] |

→ 同一service_typeの場合、`m5` 以外は**全print_typeでA4バイナリ完全同一**にフォールバック。

**5-3-2-B. `printer_type="3"` (ラベルプリンタ) × `service_type × print_type` 完全マトリクス（★最重要）:**

**発行可否の全組み合わせ（実機確定）:**

| service_type \ print_type | `0` | `2` | `3` | `4` | `5` | `7` | `8` | `9` | `A` | `m` | `m5` |
|:--:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **`0` 発払い** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **`2` コレクト** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **`3` DM** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`4` タイム** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **`5` 着払い** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`7` ゆうパケット** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **`8` コンパクト** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`9` コンパクトコレクト** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`A` ネコポス** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |

**⚠️ 重要な制約:**
1. **ラベルプリンタ設定では DM(3)/着払い(5)/コンパクト(8)/コンパクトコレクト(9) は一切印刷不可**（全print_typeで400 Error）。これらのservice_typeを使う場合は `printer_type="1"` (レーザー) に切替必須
2. **`print_type=5` と `print_type=9` は、どのservice_typeでもラベル設定時は必ず400 Error**
3. **`print_type=m5` もラベル設定時は必ず400 Error**

**5-3-2-C. ラベル設定時のMediaBoxサイズ（成功時、service_type=0 基準）:**

| print_type | MediaBox (pt) | 実寸 | ファイルサイズ | 用途 |
|-----------|--------------|------|------|------|
| `m`/`0`/`8` | 326.551×561.543 | 115.1×198.1mm | 55〜57KB | 共通ラベル |
| **`4`** | **339.023×669.543** | **119.6×236.1mm** | **67〜70KB** | **発払い専用（最大）** |
| `2` | 339.023×669.543 | 119.6×236.1mm | 54〜57KB | コレクト専用 |
| `3` | 317.480×204.094 | 112×72mm | 55〜58KB | DM/ゆうメール専用（横長小） |
| `7`/`A` | 327.685×561.543 | 115.6×198.1mm | 70〜82KB | ネコポス/ゆうパケット共通 |

※ 同じprint_type・同じMediaBoxでもservice_typeが違えばPDF内容は異なる（5-3-1参照）。

### 5-3-3. TypeScript実装パターン

```typescript
/**
 * 印刷前にプリンタ設定を切り替える（read-modify-write必須）
 */
async function setPrinterType(session: Session, value: "1" | "2" | "3"): Promise<void> {
  const settings = await session.get('/b2/p/settings');
  settings.feed.entry[0].general_settings.printer_type = value;
  const putRes = await session.put('/b2/p/settings', settings);
  if (putRes.feed?.title === 'Error') {
    throw new Error('setPrinterType failed: ' + JSON.stringify(putRes));
  }
}

/**
 * 高レベルAPI: 出力フォーマット指定で自動切替
 * - 'a4_multi' / 'a5_multi' → レーザー設定、service_typeに応じたA4/A5伝票
 * - 'label' → ラベルプリンタ設定、ただし対応service_type(0/2/4/7/A)のみ
 *   対応外(3/5/8/9)はエラーを投げる
 */
async function printWithFormat(
  session: Session,
  shipment: Shipment,
  format: 'a4_multi' | 'a5_multi' | 'label'
): Promise<Buffer> {
  // label非対応のservice_typeなら、事前に弾く
  if (format === 'label' && ['3', '5', '8', '9'].includes(shipment.service_type)) {
    throw new Error(
      `service_type=${shipment.service_type} はラベル印刷非対応。` +
      `A4(a4_multi)またはA5(a5_multi)を指定するか、伝票種別を変更してください。`
    );
  }

  const origSettings = await session.get('/b2/p/settings');
  const origPrinterType = origSettings.feed.entry[0].general_settings.printer_type;

  try {
    const targetPrinterType = format === 'label' ? "3" : "1";
    if (origPrinterType !== targetPrinterType) {
      await setPrinterType(session, targetPrinterType);
    }

    const printType = selectPrintType(shipment.service_type, format);
    const pdf = await createAndPrint(session, shipment, printType);
    return pdf;
  } finally {
    if (origPrinterType) await setPrinterType(session, origPrinterType as any);
  }
}

/**
 * service_type × format → print_type 変換表（実機確定、5-3-2-B参照）
 *
 * ★ラベル設定で印刷可能なservice_typeは限定的:
 *   - ✅ 0/2/4/7/A は全てラベル印刷可能
 *   - ❌ 3/5/8/9 はラベル印刷不可（全print_typeで400 Error）→ レーザー設定必須
 */
function selectPrintType(serviceType: string, format: 'a4_multi' | 'a5_multi' | 'label'): string {
  if (format === 'a5_multi') return 'm5';
  if (format === 'a4_multi') return 'm';

  // label (printer_type=3) 時は専用レイアウトを選ぶ
  const labelTable: Record<string, string> = {
    '0': '4',   // 発払い → ラベル発払い (70KB, 119.6×236.1mm)
    '2': '2',   // コレクト → ラベルコレクト (57KB, 119.6×236.1mm)
    '4': '4',   // タイム → ラベル発払い (68KB, 119.6×236.1mm)
    '7': '7',   // ゆうパケット → ラベル (81KB, 115.6×198.1mm)
    'A': 'A',   // ネコポス → ラベル (70KB, 115.6×198.1mm)
  };

  const pt = labelTable[serviceType];
  if (!pt) {
    throw new Error(
      `service_type=${serviceType} はラベルプリンタ印刷に対応していません` +
      `（DM(3)/着払い(5)/コンパクト(8)/コンパクトコレクト(9)はレーザー設定必須、5-3-2-B参照）`
    );
  }
  return pt;
}
```

**並列実行の注意:** `general_settings.printer_type` は**アカウント単位のグローバル設定**。同じアカウントで複数フォーマットを同時印刷すると競合する。対応:
- 排他制御（mutex）で直列化する
- または保存(`shipment_flg=0`)のみ並列化し、印刷(`shipment_flg=1`)は直列化
- MCP/APIサーバー実装では `setPrinterType→print→restore` を1リクエストで完結させる

### 5-4. print_typeとservice_typeの有効組み合わせ

→ **完全マトリクスは 5-3-2-B を参照**（全9種類の service_type × 11種類の print_type のクロス検証済み）。

**キーテイクアウト:**

1. **ラベル印刷可能な service_type**: 0 / 2 / 4 / 7 / A の5種のみ（✅）
2. **ラベル印刷不可の service_type**: 3 / 5 / 8 / 9 の4種（全print_typeで400 Error、レーザー設定必須）
3. **全service_typeで使えない print_type**: `5` / `9` / `m5` / `6` / `CP`（ラベル設定時）
4. **挙動の規則**:
   - `POST /new?issue` 時: サーバーは `service_type × printer_type × print_type` の整合性を**厳格にチェック**、不整合は400 Error
   - `PUT /history?reissue` 時: 既発行伝票に対しては部分的にフォールバック（発払い/コレクト/タイム/ゆうパケット/ネコポスは`print_type=m`でも成功）
   - レーザー設定(`printer_type=1/2`)では、service_type=0(発払い)ではほぼ全print_typeがA4フォールバック。他service_typeはservice_typeごとに挙動が異なる



---

## 6. バリデーションルール

### 6-1. 共通必須フィールド

空データでcheckonlyした際のサーバーエラーレスポンスから確定:

| フィールド | 説明 | エラーコード | エラーメッセージ |
|-----------|------|------------|----------------|
| `service_type` | サービス種別コード | — | 空はNG（サーバー内部エラー） |
| `shipment_date` | 出荷予定日 | ES003001 | 出荷予定日は本日～30日後までの範囲で指定して下さい |
| `package_qty` | 個数（1〜99） | EF029001 | 登録できる出荷予定個数は1個から99個までです |
| `consignee_telephone_display` | お届け先電話番号 | EF011001 | お届け先電話番号が入力されていません |
| `consignee_name` | お届け先名 | EF011002 | お届け先名が入力されていません |
| `consignee_zip_code` | お届け先郵便番号 | EF011004 | お届け先郵便番号が入力されていません |
| `consignee_address1` | 都道府県 | WS003001 | お届け先都道府県が入力されていません |
| `consignee_address2` | 市区町村 | EF011022 | お届け先市区郡町村が入力されていません |
| `consignee_address3` | 町・番地 | EF011009 | お届け先町・番地が入力されていません |
| `shipper_telephone_display` | ご依頼主電話番号 | EF011059 | ご依頼主電話番号が入力されていません |
| `shipper_name` | ご依頼主名 | EF011062 | ご依頼主名が入力されていません |
| `shipper_zip_code` | ご依頼主郵便番号 | EF011006 | ご依頼主郵便番号が入力されていません |
| `shipper_address1` | ご依頼主都道府県 | WS003002 | ご依頼主都道府県が入力されていません |
| `shipper_address2` | ご依頼主市区町村 | EF011008 | ご依頼主市区郡町村が入力されていません |
| `shipper_address3` | ご依頼主町・番地 | EF011063 | ご依頼主町・番地が入力されていません |
| `item_name1` | 品名 | EF011067 | 品名１が入力されていません（**DM(3)のみ不要**） |
| `invoice_code` | 請求先 | EF011082 | 請求先が設定されていません（**着払い(5)のみ不要**） |

**代替手段: `consignee_address` 一括指定**
`consignee_address`（一括住所フィールド）に全住所を入力すれば、`address1/2/3`個別指定不要。サーバー側で自動分割される（実機テスト済み）。

### 6-2. サービスタイプ固有の必須/制約

| フィールド | 発払い(0) | タイム(4) | 着払い(5) | コンパクト(8) | コレクト(2) | 複数口(6) | ネコポス(A) | ゆうパケット(7) | DM(3) | EAZY(1) |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `invoice_code` | ✅ | ✅ | ❌不要 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `item_name1` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌不要 | ✅ |
| `amount` | — | — | — | — | ✅(1〜300,000) | — | — | — | — | — |
| `closure_key` | — | — | — | — | — | ✅ | — | — | — | — |
| `delivery_time_zone` | 標準値 | **タイム専用値（6-2-T参照）** | 標準値 | 標準値 | 標準値 | 標準値 | 標準値 | 標準値 | 標準値 | 標準値 |

**コレクト(2)の詳細:**
- `amount='0'` → EF011020「代金引換額が入力されていません」
- `amount='1000'` → OK
- `amount='9999999'` → エラー（上限超過）
- `amount='-100'` → エラー（負数不可）

**複数口(6)の詳細:**
- `closure_key`必須 → 欠時ES002622「複数口くくりキーが入力されていません」
- `closure_key`は任意の文字列OK（`"01"` / `"1"`どちらも受付）
- **`package_qty`合計が2〜99個必須** → 範囲外でES002624「発払い（複数口）をご利用の場合、個数の合計が2個から99個になるように入力してください」
- 1件のentryで複数口を表現する場合、`package_qty="2"` 以上を指定するか、複数entryを束ねて合計2個以上とする

**6-2-T. タイム(4) の `delivery_time_zone` は専用値のみ受付（★重要、実機確定）:**

タイムサービスは**2つの時間帯コード**のみ許可される。他のサービスタイプで使う通常時間帯コード（`0000`/`0812`/`1214`等）を指定すると `ES002038: 時間帯指定の内容が正しくありません。` エラー。

| `delivery_time_zone` | 意味 | 備考 |
|:--------------------:|------|------|
| `"0010"` | 午前10時まで | タイム便デフォルト |
| `"0017"` | 午後5時まで | — |
| 上記以外（`"0000"`, `"0812"`, `"1214"`, `"1416"`, `"1618"`, `"1820"`, `"2021"`, `"1921"`） | ❌ | ES002038 エラー |

**通常サービスタイプ(0/5/8/2/6/7/A/3/1) の `delivery_time_zone` 標準値:**

| コード | 意味 |
|:------:|------|
| `"0000"` | 指定なし |
| `"0812"` | 午前中 |
| `"1214"` | 12時〜14時 |
| `"1416"` | 14時〜16時 |
| `"1618"` | 16時〜18時 |
| `"1820"` | 18時〜20時 |
| `"1921"` | 19時〜21時（一部地域） |
| `"2021"` | 20時〜21時（定数定義のみ） |

→ JS定数マップ（`DELIVERY_TIME_ZONE_{CODE}_CD` / `_NM`）から抽出、実機で`"0000"`〜`"1921"`の受付を確認済み。

### 6-3. オプションON時の追加必須フィールド

| オプション | ON時に必須 | エラーコード |
|-----------|----------|------------|
| `is_using_shipment_email=1` | `shipment_email_address` | EF011012 |
| `is_using_shipment_email=1` | `shipment_message` | EF011013 |
| `is_using_delivery_email=1`（有料10円） | `delivery_email_address` | EF011014 |
| `is_using_delivery_email=1` | `delivery_message` | EF011015 |
| `is_using_center_service=1` | `consignee_center_code` | EF011003 |
| `is_using_shipment_post_email=1` | `shipment_post_email_address` | EF021012 |
| `is_using_shipment_post_email=1` | `shipment_post_message` | EF021013 |
| `is_using_cons_deli_post_email=1`（★ネコポス(A)のみ検証時エラー発生） | `cons_deli_post_email_address` | EF031012 |
| `is_using_cons_deli_post_email=1` | `cons_deli_post_message` | EF031013 |
| `is_using_shipper_deli_post_email=1`（★ネコポス(A)のみ検証時エラー発生） | `shipper_deli_post_email_address` | EF041012 |
| `is_using_shipper_deli_post_email=1` | `shipper_deli_post_message` | EF041013 |
| `is_agent=1`（収納代行） | **12項目必須（実機確定）** — 下表参照 | — |
| `search_key1〜4` 入力時 | 対応する `search_key_title1〜4` | — |
| `is_printing_date=1` + `short_delivery_date_flag=0` | `delivery_date` | — |

**注意:** `is_using_shipment_email=1` でメールアドレスを指定しても、`shipment_message`が空だとエラー。両方必須。

**★ 投函完了メール系（`is_using_cons_deli_post_email` / `is_using_shipper_deli_post_email`）のバリデーション挙動:**

サーバーは **service_type（伝票種別）に応じてバリデーションを切り替える**（実機確定）:
- `service_type=A` (ネコポス): `is_using_cons_deli_post_email=1` を立てるとアドレス・メッセージ欠けで EF031012/EF031013 エラー、`is_using_shipper_deli_post_email=1` で EF041012/EF041013 エラー
- `service_type=0/3/7` (発払い/DM/ゆうパケット): フラグを立てても投函メール系のバリデーションは走らない（空でも error_flg=0）

→ つまり投函完了メールは**ネコポス専用の機能**。投函のない伝票ではフラグの有無に関わらず無視される。

**`is_agent=1`（収納代行）の必須12項目（実機で完全特定済み、Pythonコメントの「13項目」は誤り）:**

| # | フィールド | エラーコード | 説明 |
|---|-----------|-------------|------|
| 1 | `agent_amount` | EF011024 | 収納代行請求金額（税込） |
| 2 | `agent_tax_amount` | EF011026 | 収納代行内消費税額等 |
| 3 | `agent_invoice_zip_code` | EF011027 | 収納代行請求先郵便番号 |
| 4 | `agent_invoice_address2` | EF011028 | 収納代行請求先市区郡町村 |
| 5 | `agent_invoice_address3` | EF011029 | 収納代行請求先町・番地 |
| 6 | `agent_invoice_name` | EF011030 | 収納代行請求先名 |
| 7 | `agent_invoice_kana` | EF011031 | 収納代行請求先名略称ｶﾅ |
| 8 | `agent_request_name` | EF011032 | 収納代行請求元名 |
| 9 | `agent_request_zip_code` | EF011033 | 収納代行請求元郵便番号 |
| 10 | `agent_request_address2` | EF011034 | 収納代行請求元市区郡町村 |
| 11 | `agent_request_address3` | EF011035 | 収納代行請求元町・番地 |
| 12 | `agent_request_telephone` | EF011036 | 収納代行請求元電話番号 |

**注意:** `is_agent=1`はアカウント単位で利用可否が設定されており、未契約アカウントでは `ES017002: 収納代行は利用できません` が出る。上記12項目は**契約済みアカウントでのみ必須**。

### 6-4. 文字数制限（全角=2カウント、半角=1カウント）

| フィールド | 最大バイト数 | 全角最大 | 半角最大 | 境界値テスト結果 | エラーコード |
|-----------|-----------|---------|---------|---------------|------------|
| `consignee_name` | 32 | 16全角 | 32半角 | 16全角OK, 17全角NG | ES001010 |
| `consignee_address2` | 24 | 12全角 | 24半角 | 12全角OK, 13全角NG | — |
| `consignee_address3` | 32 | 16全角 | 32半角 | 16全角OK, 17全角NG | — |
| `consignee_address4` | 32 | 16全角 | 32半角 | 16全角OK, 17全角NG | — |
| `consignee_department1` | 50 | 25全角 | 50半角 | 25全角OK, 26全角NG | — |
| `consignee_department2` | 50 | 25全角 | 50半角 | — | — |
| `consignee_name_kana` | 50 | — | 50半角 | **半角カタカナのみ** | — |
| `consignee_telephone_display` | 15 | — | 15半角 | — | — |
| `consignee_telephone_ext` | 2 | — | 2半角 | — | — |
| `consignee_title` | 4 | 2全角 | 4半角 | 様OK, 御中OK, 空OK | — |
| `consignee_zip_code` | 8 | — | 8半角 | ハイフン有無OK | — |
| `consignee_center_code` | 6 | — | 6半角 | — | — |
| `shipper_name` | 32 | 16全角 | 32半角 | 16全角OK, 17全角NG | — |
| `shipper_address2` | 24 | 12全角 | 24半角 | — | — |
| `shipper_address3` | 32 | 16全角 | 32半角 | — | — |
| `shipper_address4` | 32 | 16全角 | 32半角 | — | — |
| `shipper_telephone_display` | 15 | — | 15半角 | — | — |
| `shipper_zip_code` | 8 | — | 8半角 | — | — |
| `item_name1/2` | 50 | 25全角 | 50半角 | 25全角OK, 26全角NG | — |
| `item_code1/2` | 30 | — | 30半角 | — | — |
| `handling_information1/2` | 20 | 10全角 | 20半角 | 10全角OK, 11全角NG | — |
| `note` | 44 | 22全角 | 44半角 | 22全角OK, 23全角NG | — |
| `shipment_number` | 50 | — | 50半角 | 50半角OK, 51半角NG | — |
| `search_key1〜4` | 20 | — | 20半角 | 20半角OK, 21半角NG | ES002070 |
| `search_key_title1〜4` | 20 | — | 20半角 | — | — |
| `amount` | 7桁 | — | 7半角 | 最大300,000 | EF011020 |
| `package_qty` | 2桁 | — | 2半角 | 99OK, 100NG | EF029001 |

### 6-5. フォーマット制約

| フィールド | 制約 | テスト結果 | エラーコード |
|-----------|------|----------|------------|
| `shipment_date` | `YYYYMMDD` or `YYYY/MM/DD`のみ | `YYYY-MM-DD`はNG | ES003001 |
| `shipment_date` | 本日〜30日後 | 過去日NG, 31日後NG | ES003001 |
| `consignee_telephone_display` | 数字・ハイフンのみ | 英字NG, ハイフン付OK, ハイフンなしOK | ES002007 |
| `consignee_zip_code` | 有効な郵便番号 | ハイフン有無OK, 9999999NG | EF016001 |
| `consignee_name_kana` | **半角カタカナのみ** | ﾃｽﾄﾀﾛｳ=OK, テストタロウ(全角)=NG | — |
| `search_key1〜4` | **半角英数字+スペースのみ** | 英字OK, 数字OK, 混合OK, スペースOK | ES002070 |
| `search_key1〜4` | アンダースコア不可 | `abc_123`=NG | ES002070 |
| `search_key1〜4` | ハイフン不可 | `abc-123`=NG | ES002070 |
| `search_key1〜4` | 全角不可 | `テスト検索`=NG | ES002070 |
| `email系` | メール形式 | 不正形式NG | — |
| `delivery_time_zone` | サービスタイプ別に専用コード | 通常=`0000`/`0812`/`1214`/`1416`/`1618`/`1820`/`1921`/`2021`、タイム(4)=`0010`/`0017` のみ（6-2-T参照） | ES002038 |

### 6-6. delivery_date（お届け希望日）の挙動

**short_delivery_date_flag × is_printing_date × delivery_date の完全マトリクス（実機確定）:**

| is_printing_date | short_delivery_date_flag | delivery_date | 結果 |
|:-:|:-:|:-:|:-:|
| `1` | `1` | 空 | ✅ OK |
| `1` | `1` | 指定あり | ✅ OK |
| **`1`** | **`0`** | **空** | **❌ EF011017「お届け予定日が入力されていません」** |
| `1` | `0` | 指定あり | ✅ OK |
| `0` | 任意 | 任意 | ✅ OK |

**実装ルール（確定版）:**
- `is_printing_date=1` かつ `short_delivery_date_flag=0` の組み合わせでは **delivery_date必須**（EF011017）
- `is_printing_date=1` かつ `short_delivery_date_flag=1` は**最短日を自動計算**（delivery_date不要）
- `is_printing_date=0` では **delivery_date不要**（お届け日印字なし）
- Pythonコードのコメント「flag=0はdelivery_date必須、flag=1はdelivery_date指定禁止」は半分正しい:
  - flag=0でdelivery_date必須は `is_printing_date=1` の時のみ
  - flag=1でdelivery_date指定は**許容される**（エラーにはならない）

**delivery_date単体の範囲制約（is_printing_dateに依存しない）:**

| delivery_date | 結果 | 備考 |
|-------------|------|------|
| 翌日 | ✅ OK | — |
| 7日後 | ✅ OK | — |
| 14日後 | ⚠️ ルート依存 | 遠距離は14日以降NG |
| 30日後 | ✅ OK | — |
| 31日後 | ❌ NG | 範囲外 |

### 6-7. is_cool × サービスタイプ（全15組み合わせ）

| | 普通(0) | 冷凍(1) | 冷蔵(2) |
|---|:-:|:-:|:-:|
| 発払い(0) | ✅ OK | ✅ OK | ✅ OK |
| タイム(4) | ✅ OK | ✅ OK | ✅ OK |
| 着払い(5) | ✅ OK | ✅ OK | ✅ OK |
| コンパクト(8) | ✅ OK | ✅ OK | ✅ OK |
| ネコポス(A) | ✅ OK | ✅ OK | ✅ OK |

**全組み合わせがcheckonlyを通過する。** 物理的に不可能な組合せ（ネコポス+冷凍等）もAPIレベルではエラーにならない。印刷時やドライバー受付時に拒否される可能性がある。

### 6-8. 複数伝票一括checkonly

```json
POST /b2/p/new?checkonly
{
  "feed": {
    "entry": [
      {"shipment": {...shipment1}},
      {"shipment": {...shipment2}},
      {"shipment": {...shipment3_with_error}}
    ]
  }
}
```

**挙動:**
- `feed.title = "Error"` → 1件でもエラーがあればError
- 各`entry`に独立した`error`配列 → 個別にどのエントリがNGか判別可能
- エラーなしのエントリはそのまま保存に使える
- **100件一括でも動作確認済み**（実測詳細は付録D参照）

**圧縮後ペイロードサイズの実測（業務データ、msgpack+zlib後のBody送信サイズ）:**

| バッチサイズ | JSON | msgpack+zlib | 備考 |
|-----------|------|-------------|------|
| 10件 | 9.8KB | 422B | — |
| 50件 | 48.9KB | 1.0KB | — |
| 100件 | 97.8KB | 1.6KB | — |
| 500件 | 491KB | 6.4KB | — |
| 1,000件 | 982KB | 12.2KB | — |
| 5,000件 | 4.7MB | 57.5KB | Vercel 4.5MB body制限を超えるためJSONでは送れない |

→ Vercel/AWS Lambda の body size 制限がある場合、**msgpackパスが必須**になる件数は約500件以上（JSON 491KBならまだOKだが、念のため）。

**サーバーレスポンス時間は別途要測定**（ブラウザからの実測は未実施、Node.js実装時にE-2 #5で検証予定）。

### 6-9. checkonly時のサーバー自動補完フィールド

checkonlyを通すと、以下のフィールドがサーバー側で自動設定される:

| フィールド | 自動設定される値 | 説明 |
|-----------|---------------|------|
| `checked_date` | `"2026-04-16 09:32:00"` | チェック日時 |
| `is_printing_lot` | `"1"` | ロット印刷フラグ |
| `error_flg` | `"9"` | エラーフラグ（9=正常） |
| `display_flg` | `"1"` | 表示フラグ |
| `is_agent` | `"0"` | 収納代行フラグ |
| `is_cool` | `"0"` | クール区分（未指定時） |
| `delivery_time_zone` | `"0000"` | 配達時間帯（未指定時） |
| `consignee_title` | `"様"` | 敬称（未指定時） |
| `shipper_title` | `"様"` | 敬称（未指定時） |
| `sorting_code` | `""` | 仕分けコード |
| `sorting_ab` | `""` | 仕分け区分 |

### 6-10. consignee_title（敬称）の許容値

| 値 | 結果 |
|---|------|
| `"様"` | ✅ OK |
| `"御中"` | ✅ OK |
| `""` (空) | ✅ OK |

### 6-11. is_printing_date / is_printing_lot

| フィールド | 値 | 結果 | 備考 |
|-----------|---|------|------|
| `is_printing_date` | `"0"` | ✅ OK | お届け日を印字しない |
| `is_printing_date` | `"1"` | ✅ OK | お届け日を印字する（delivery_date依存） |
| `is_printing_lot` | `"1"` | ✅ OK | サーバーデフォルト |
| `is_printing_lot` | `"2"` | ✅ OK | — |
| `is_printing_lot` | `"3"` | ✅ OK | — |

### 6-12. その他のオプションフィールド

| フィールド | テスト結果 | 備考 |
|-----------|----------|------|
| `notification_email_address` | ✅ OK | 通知メールアドレス、設定可能 |
| `direct_delivery_type` | ✅ OK | 直接配達区分、設定可能 |
| `cooperation_number` | ✅ OK | 連携番号、設定可能 |
| `printer_type` | `"1"` OK, `"2"` OK, `"3"` OK | 伝票メタ情報。**PDF出力形式には影響しない**（出力形式は `general_settings.printer_type` で決まる、5-3-2参照）。保存時にサーバーが `"1"` に上書きすることあり |
| `amount`（発払い時） | ✅ OK（無視される） | 発払い伝票でamount指定しても無視 |

### 6-13. 値の型・null・空文字の扱い（JSON送信時）

**数値型フィールドの扱い:**

| 値 | `package_qty` | `amount` | 結果 |
|----|:-:|:-:|:-:|
| 文字列 `"1"` | ✅ | ✅ | 受付 |
| 数値 `1` | ✅ | ✅ | 受付（JSON送信時は自動的に数値になる） |

**結論:** JSON送信時は文字列・数値どちらでも動作。**ただしB2クラウド本来のmsgpackプロトコルでは`f2a→e2a`が値を`replaceControlCode()`に通すため、最終的には文字列に変換される**。TS実装では以下の方針:

```typescript
// src/types.ts
// B2クラウドの値は全て文字列として扱う（msgpackパイプラインと一貫）
export type ShipmentFieldValue = string | null | undefined;

// 数値フィールドも文字列として定義
interface Shipment {
  package_qty: string;   // "1" ~ "99"（msgpack時は文字列必須）
  amount: string;         // "1" ~ "300000"
  // ...
}
```

**null / 空文字 / undefined の扱い（実機確認）:**

| 値 | 挙動 |
|----|------|
| `null` | ✅ 受付。空文字 `""` と同等に扱われる |
| `""` (空文字) | ✅ 受付。フィールド未指定と同等 |
| `undefined` | ✅ 受付。JSON.stringifyで除去されるため問題なし |

**B2クラウド元JSの`replaceControlCode`動作:**
```javascript
B2GLOBAL.replaceControlCode = function(e) {
  return void 0 === e || null === e ? "" : e.replace(new RegExp(CONTROL_CODE), "")
};
```
→ undefined/null は必ず `""` に変換される。TS実装でもこの動作を正確に再現する。

### 6-14. `consignee_address`一括指定

**通常の住所指定:**
```json
{
  "consignee_address1": "東京都",
  "consignee_address2": "千代田区",
  "consignee_address3": "千代田1-1"
}
```

**一括指定（代替可能、実機確認済み）:**
```json
{
  "consignee_address": "東京都千代田区千代田1-1"
}
```

- `address1/2/3` を個別指定しなくても、`consignee_address`に全住所を入れれば **サーバー側で自動的に分割**してバリデーション通過
- ただしサーバー側の分割ロジックは完璧ではないため、**長い住所（address3が32バイト超）は `consignee_address3` の長さオーバーエラー（ES001014）になる可能性**がある
- **推奨: address1/2/3 を明示的に分割して送る**（サーバーの自動分割に頼らない）
- `shipper_address` も同様に一括指定可能

### 6-15. 全エラーコード一覧

**必須フィールドエラー:**

| コード | フィールド | メッセージ |
|-------|----------|----------|
| EF011001 | consignee_telephone_display | お届け先電話番号が入力されていません |
| EF011002 | consignee_name | お届け先名が入力されていません |
| EF011003 | consignee_center_code | 営業所コードが入力されていません |
| EF011004 | consignee_zip_code | お届け先郵便番号が入力されていません |
| EF011006 | shipper_zip_code | ご依頼主郵便番号が入力されていません |
| EF011008 | shipper_address2 | ご依頼主市区郡町村が入力されていません |
| EF011009 | consignee_address3 | お届け先町・番地が入力されていません |
| EF011012 | shipment_email_address | お届け予定eメールアドレスが入力されていません |
| EF011013 | shipment_message | お届け予定eメールメッセージが入力されていません |
| EF011014 | delivery_email_address | お届け完了eメールアドレスが入力されていません |
| EF011015 | delivery_message | お届け完了eメールメッセージが入力されていません |
| EF011017 | delivery_date | お届け予定日が入力されていません（is_printing_date=1 + short_delivery_date_flag=0） |
| EF011020 | amount | 代金引換額が入力されていません |
| EF011022 | consignee_address2 | お届け先市区郡町村が入力されていません |
| EF021012 | shipment_post_email_address | 投函予定メールアドレスが入力されていません |
| EF021013 | shipment_post_message | 投函予定メールメッセージが入力されていません |
| EF031012 | cons_deli_post_email_address | 投函完了メール（お届け先宛）アドレスが入力されていません（ネコポス(A)のみ） |
| EF031013 | cons_deli_post_message | 投函完了メール（お届け先宛）メッセージが入力されていません（ネコポス(A)のみ） |
| EF041012 | shipper_deli_post_email_address | 投函完了メール（ご依頼主宛）アドレスが入力されていません（ネコポス(A)のみ） |
| EF041013 | shipper_deli_post_message | 投函完了メール（ご依頼主宛）メッセージが入力されていません（ネコポス(A)のみ） |
| EF011024 | agent_amount | 収納代行請求金額（税込）が入力されていません |
| EF011026 | agent_tax_amount | 収納代行内消費税額等が入力されていません |
| EF011027 | agent_invoice_zip_code | 収納代行請求先郵便番号が入力されていません |
| EF011028 | agent_invoice_address2 | 収納代行請求先市区郡町村が入力されていません |
| EF011029 | agent_invoice_address3 | 収納代行請求先町・番地が入力されていません |
| EF011030 | agent_invoice_name | 収納代行請求先名が入力されていません |
| EF011031 | agent_invoice_kana | 収納代行請求先名略称ｶﾅが入力されていません |
| EF011032 | agent_request_name | 収納代行請求元名が入力されていません |
| EF011033 | agent_request_zip_code | 収納代行請求元郵便番号が入力されていません |
| EF011034 | agent_request_address2 | 収納代行請求元市区郡町村が入力されていません |
| EF011035 | agent_request_address3 | 収納代行請求元町・番地が入力されていません |
| EF011036 | agent_request_telephone | 収納代行請求元電話番号が入力されていません |
| EF011059 | shipper_telephone_display | ご依頼主電話番号が入力されていません |
| EF011062 | shipper_name | ご依頼主名が入力されていません |
| EF011063 | shipper_address3 | ご依頼主町・番地が入力されていません |
| EF011067 | item_name1 | 品名１が入力されていません |
| EF011082 | invoice_code | 請求先が設定されていません |

**フォーマット・制約エラー:**

| コード | フィールド | メッセージ |
|-------|----------|----------|
| ES001010 | consignee_name | お届け先名が長すぎます |
| ES001014 | consignee_address3 | お届け先町・番地が長すぎます（`consignee_address`一括指定で全住所がaddress3に入った場合など） |
| ES002007 | consignee_telephone_display | お届け先電話番号の内容が正しくありません |
| ES002038 | delivery_time_zone | 時間帯指定の内容が正しくありません（タイムで通常時間帯コード指定、または通常サービスでタイム用コード指定時） |
| ES002070 | search_key4 | 検索キー4の内容が正しくありません |
| ES002622 | closure_key | 複数口くくりキーが入力されていません（service_type=6のみ） |
| ES002624 | package_qty | 発払い（複数口）をご利用の場合、個数の合計が2個から99個になるように入力してください |
| ES003001 | shipment_date | 出荷予定日は本日～30日後までの範囲で指定して下さい |
| ES006002 | invoice_code | 請求先が存在しません（無効な請求先コード、または枝番不一致） |
| ES017002 | is_agent | 収納代行は利用できません（アカウント未契約） |
| EF016001 | consignee_zip_code | お届け先郵便番号が誤っています |
| EF029001 | package_qty | 登録できる出荷予定個数は1個から99個までです |
| WS003001 | consignee_address1 | お届け先都道府県が入力されていません |
| WS003002 | shipper_address1 | ご依頼主都道府県が入力されていません |
| SE0023 | — | 印刷対象の伝票がありません |

---

## 7. 環境変数設計

### 7-1. 必須

```env
B2_CUSTOMER_CODE=        # お客様コード（例: 0482540070）
B2_CUSTOMER_PASSWORD=    # パスワード
MCP_API_KEY=             # MCPアクセスキー（b2mcp-xxxxx形式で自動生成）
```

### 7-2. 任意

```env
B2_CUSTOMER_CLS_CODE=    # お客様コード枝番（デフォルト: 空）
B2_LOGIN_USER_ID=        # 個人ユーザーID（デフォルト: 空）
B2_DEFAULT_PRINT_TYPE=   # デフォルト用紙（デフォルト: m5）
B2_DEFAULT_SHIPPER_NAME= # デフォルトご依頼主名
B2_DEFAULT_SHIPPER_TEL=  # デフォルトご依頼主電話番号
B2_DEFAULT_SHIPPER_ZIP=  # デフォルトご依頼主郵便番号
B2_DEFAULT_SHIPPER_ADDR1= # デフォルトご依頼主住所1（都道府県）
B2_DEFAULT_SHIPPER_ADDR2= # デフォルトご依頼主住所2（市区町村）
B2_DEFAULT_SHIPPER_ADDR3= # デフォルトご依頼主住所3（町・番地）
```

### 7-3. ヘッダーオーバーライド

REST APIでは環境変数の代わりにリクエストヘッダーで認証情報を渡せる:

```
X-B2-Customer-Code: {code}
X-B2-Customer-Password: {password}
X-B2-Customer-Cls-Code: {cls_code}
X-B2-Login-User-Id: {user_id}
```

---

## 8. REST API設計

### 8-1. 認証

```
POST /api/b2/login
  → B2クラウドにログインしセッションを確立
  Response: { status: "ok", customerCode: "...", customerName: "..." }
```

### 8-2. 伝票操作

```
POST /api/b2/check
  Body: { shipments: [{ service_type, consignee_name, ... }] }
  → checkonly実行
  Response: { results: [{ valid: true, shipment: {...} }] }

POST /api/b2/save
  Body: { shipments: [{ ... }] }
  → checkonly → 保存
  Response: { saved: [{ id, tracking_number }] }

POST /api/b2/print
  Body: { shipments: [{...}], print_type?: "m5" }
  → checkonly → 保存 → 印刷 → PDF取得
  Response: { tracking_numbers: [...], pdf: "base64..." }

GET /api/b2/pdf?issue_no={no}
  → issue_noでPDFを直接取得
  Response: application/pdf

POST /api/b2/reprint
  Body: { tracking_number: "...", print_type?: "m5" }
  → 履歴から再印刷
  Response: { pdf: "base64..." }
```

### 8-3. 検索

```
GET /api/b2/history
  Query: tracking_number, search_key4, service_type, from_date, to_date
  Response: { entries: [...] }

GET /api/b2/saved
  Query: service_type
  Response: { entries: [...] }

DELETE /api/b2/saved
  Body: { ids: [...] }
  Response: { deleted: true }
```

---

## 9. MCPツール設計

### 9-1. ツール一覧

| ツール名 | 説明 | 主なパラメータ |
|---------|------|----------|
| `create_and_print_shipment` | 伝票作成→印刷→PDF取得の一括実行 | `service_type`, `consignee_*`, `item_name1`, `shipper_*`(任意), `print_type`, `output_format`, `search_key4` |
| `validate_shipment` | 伝票データのバリデーションのみ（checkonly） | `service_type`, `consignee_*`, `item_name1`, `shipper_*`(任意) |
| `save_shipment` | 伝票を保存のみ（印刷しない） | `validate_shipment` と同じ + `search_key4` |
| `print_saved_shipments` | 保存済み伝票を印刷（`tracking_number`=UMN形式の内部ID で指定） | `tracking_numbers: string[]`, `print_type?`, `output_format?` |
| `search_history` | 発行済み伝票を検索 | `tracking_number?`, `search_key4?`, `service_type?`, `from_date?`, `to_date?`（すべて任意、AND検索） |
| `get_tracking_info` | 追跡番号(12桁)で伝票情報を取得 | `tracking_number: string`（ヤマト12桁） |
| `reprint_shipment` | 発行済み伝票を再印刷（`checkonly=1`待機込み） | `tracking_number: string`, `print_type?`, `output_format?` |
| `delete_saved_shipments` | 保存済み伝票を削除（`DELETE /new`） | `ids: string[]`（UMN形式内部ID） |
| `get_account_info` | アカウント情報（請求先・担当営業所等）を取得 | — |
| `list_saved_shipments` | 保存済み伝票一覧を取得 | `service_type?`, `search_key4?` |
| `get_printer_settings` | 現在のプリンタ設定を取得（`GET /b2/p/settings`） | — |
| `set_printer_type` | プリンタ種別を切替（`PUT /b2/p/settings`、read-modify-write） | `printer_type: "1" \| "2" \| "3"` |

**パラメータの凡例:**
- `consignee_*`: `consignee_name`, `consignee_telephone_display`, `consignee_zip_code`, `consignee_address`（または address1/2/3）, `consignee_title?`, `consignee_name_kana?`
- `shipper_*`: `shipper_name`, `shipper_telephone_display`, `shipper_zip_code`, `shipper_address1/2/3`（環境変数デフォルトあり）
- `print_type`: `"m"` / `"m5"` / `"4"` 等（5-2参照）
- `output_format`: `"a4_multi"` / `"a5_multi"` / `"label"`（5-3-3 printWithFormat参照）。指定するとツール内部で `general_settings.printer_type` を自動切替

### 9-2. create_and_print_shipment の入力スキーマ

```typescript
{
  // 必須
  service_type: "0" | "4" | "5" | "8",
  consignee_name: string,
  consignee_telephone_display: string,  // ★フィールド名は _display 付き（6-1参照）
  consignee_zip_code: string,
  consignee_address: string,   // 一括指定（address1/2/3に自動分割、6-14参照）
  item_name1: string,           // ★正確なフィールド名は item_name1

  // 任意（住所を個別指定したい場合は一括指定の代わりに）
  consignee_address1?: string,
  consignee_address2?: string,
  consignee_address3?: string,
  consignee_address4?: string,
  shipment_date?: string,       // デフォルト: 本日
  print_type?: string,          // デフォルト: m5
  package_qty?: string,         // ★文字列必須（6-13参照）。例: "1"
  delivery_time_zone?: string,  // ★サービスタイプ別。タイム(4)は "0010"/"0017" のみ（6-2-T参照）
  is_cool?: "0" | "1" | "2",
  note?: string,
  handling_information1?: string,
  handling_information2?: string,

  // 出力フォーマット制御（実装時、5-3-3 printWithFormat参照）
  output_format?: "a4_multi" | "a5_multi" | "label",

  // コレクト(2)/コンパクトコレクト(9)時に必須
  amount?: string,              // "1"〜"300000"

  // ご依頼主（環境変数デフォルトあり）
  shipper_name?: string,
  shipper_telephone_display?: string,
  shipper_zip_code?: string,
  shipper_address1?: string,
  shipper_address2?: string,
  shipper_address3?: string,

  // 管理
  search_key1?: string,
  search_key_title1?: string,
  search_key2?: string,
  search_key_title2?: string,
  search_key3?: string,
  search_key_title3?: string,
  search_key4?: string,
  search_key_title4?: string,
}
```

### 9-3. MCPツールのレスポンス形式

**MCPの `tools/call` 応答は `content: ContentBlock[]` 配列として返す。** PDFなどのバイナリは `resource` ブロックに `base64` エンコードで封入する。

```typescript
// src/mcp-tools.ts より抜粋
import type { CallToolResult, TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP ツールレスポンスの標準形式（Anthropic MCP SDK）
 */
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }    // base64
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };
```

**ツール別レスポンス設計:**

| ツール名 | レスポンス内容 | 形式 |
|---------|-------------|------|
| `create_and_print_shipment` | issue_no + 追跡番号 + PDF | 1) `text` (JSON: issue_no, tracking_number, internalTracking) 2) `resource` (mimeType: "application/pdf", blob: base64) |
| `validate_shipment` | エラー配列 or 成功サマリー | `text` (JSON) |
| `save_shipment` | tracking_number (UMN形式) | `text` (JSON) |
| `print_saved_shipments` | issue_no 配列 + PDF | `text` (JSON) + `resource`(PDF) |
| `search_history` / `list_saved_shipments` | 伝票一覧 | `text` (JSON。件数が多い場合は最大50件に制限して先頭のみ返す) |
| `get_tracking_info` | shipment詳細 | `text` (JSON) |
| `reprint_shipment` | PDF | `text` + `resource`(PDF) |
| `delete_saved_shipments` | 削除件数 | `text` (JSON) |
| `get_account_info` | customer オブジェクト | `text` (JSON) |
| `get_printer_settings` | general_settings | `text` (JSON) |
| `set_printer_type` | 変更結果 | `text` (JSON: { before, after, success }) |

**実装例（`create_and_print_shipment`）:**

```typescript
export async function createAndPrintShipmentTool(
  session: Session,
  input: CreateAndPrintInput
): Promise<CallToolResult> {
  try {
    const shipment = mapInputToShipment(input);
    const result = await createAndPrint(session, shipment, input.print_type || 'm5');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            issueNo: result.issueNo,
            trackingNumber: result.trackingNumber,
            internalTracking: result.internalTracking,
            pdfSize: result.pdf.length,
          }, null, 2),
        },
        {
          type: 'resource',
          resource: {
            uri: `b2cloud://pdf/${result.issueNo}.pdf`,
            mimeType: 'application/pdf',
            blob: result.pdf.toString('base64'),
          },
        },
      ],
      isError: false,
    };
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        content: [{
          type: 'text',
          text: `バリデーションエラー:\n${err.errors.map(e =>
            `- ${e.error_code}: ${e.error_property_name} — ${e.error_description}`
          ).join('\n')}`,
        }],
        isError: true,
      };
    }
    return {
      content: [{
        type: 'text',
        text: `エラー: ${err instanceof Error ? err.message : String(err)}`,
      }],
      isError: true,
    };
  }
}
```

**レスポンスサイズの注意:**
- MCP の1レスポンスは数MBまで。PDFは通常 60-120KB なので問題ない
- 大量取得ツール (`search_history`) は **最大50件に制限**、さらに `summary` フィールドで全件数だけ返し、詳細は別ツール呼び出しを促す

---

## 10. 既存Pythonコードのバグ一覧

| # | 深刻度 | 内容 | 影響 |
|---|-------|------|------|
| 1 | 🔴重大 | サーバーURL `newb2web-s2` ハードコード | 他サーバーに振り分けられるユーザーで動作しない |
| 2 | 🔴重大 | 全API URLもハードコード（20箇所以上） | 同上 |
| 3 | 🔴重大 | **`invoice_code_ext`に枝番を入れている** | 実際は空文字が正解、枝番は`invoice_freight_no`へ。誤値でES006002「請求先が存在しません」が発生 |
| 4 | 🔴重大 | **print issue時の entry構造が不完全** | `id` + `link`両方必須、`id`末尾に`,{revision}`必須。片方だけだと500/409エラー |
| 5 | 🟡中 | service_type=7 を「ネコポス」と誤記 | 実際は「ゆうパケット」。ネコポスは「A」 |
| 6 | 🟡中 | msgpack+zlibパイプラインをPythonで手動再実装 | 元JSから直接移植すべき。手動実装はバグリスクが高い |
| 7 | 🟡中 | **`is_agent=1`必須項目を「13項目」とコメント** | 実際は12項目（実機確定、6-3参照） |
| 8 | 🟡中 | **再印刷時の`B2_OKURIJYO?checkonly=1`完了確認を省略** | 省略すると96バイトHTMLエラーが返る（4-7参照） |
| 9 | 🟡中 | **`general_settings.printer_type`を考慮していない** | PDF出力形式はプリンタ設定で決まる。Pythonコードは常にA4を受け取る前提だが、ラベル印刷したい場合はラベルプリンタ設定に切替必須（5-3-2参照） |
| 10 | 🟡中 | **service_type と print_type の厳格な整合性チェックを無視** | `POST /new?issue` は service_type × printer_type × print_type の3軸整合をサーバー側で厳格チェック。不整合は400 Error（5-3-2-B参照）。特にラベル設定で DM(3)/着払い(5)/コンパクト(8)/コンパクトコレクト(9) は全print_type NG |
| 11 | 🟡中 | **タイム(4)の `delivery_time_zone` 専用値を知らない** | タイム便は `0010`/`0017` のみ、通常コードはES002038エラー（6-2-T参照） |
| 12 | 🟡中 | **EAZY(1) はアカウント契約が必要** | `ES002005: service_type` で利用不可。契約状態を確認してから利用する設計が必要 |
| 13 | 🟢軽 | `split_pdf_dm` のlength引数未指定（READMEバグ） | README通りに使うとエラー |
| 14 | 🟢軽 | `print_issue` のisnew判定ロジック | `tracking_number in ...` は空文字でもTrue |
| 15 | 🟢軽 | `get_new` のreturn後print文 | 到達不能コード |

---

## 11. 実装計画

### Phase 1: コアライブラリ（1-2日）

1. `src/auth.ts` — ログイン/セッション管理
2. `src/b2client.ts` — HTTPクライアント（Cookie管理付き、msgpack/JSON両対応）
3. `src/msgpack.ts` — **msgpack+zlib圧縮パイプライン（元JSのf2a/e2a/t2m/t2m2直接移植）**
4. `src/types.ts` — TypeScript型定義
5. `src/constants.ts` — 全定数（FIELD_PATTERN, CONTROL_CODE含む）
6. `src/validation.ts` — Zodバリデーション
7. `src/shipment.ts` — 伝票CRUD
8. `src/print.ts` — 印刷/PDF取得

### Phase 2: API/MCP（1日）

9. `api/b2/*.ts` — REST APIエンドポイント
10. `src/mcp-tools.ts` — MCPツール定義
11. `api/mcp.ts` — MCP SSEエンドポイント

### Phase 3: デプロイ・テスト（1日）

12. `vercel.json` — デプロイ設定
13. `.env.example` — 環境変数テンプレート
14. `README.md` — Deploy Buttonつき
15. Vitestテスト

---

## 12. Vercelデプロイ設定

### vercel.json

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".",
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 30
    }
  },
  "rewrites": [
    { "source": "/mcp", "destination": "/api/mcp" }
  ]
}
```

### Deploy Button (README.md)

```markdown
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDaisukeHori%2Fb2cloud-api&env=B2_CUSTOMER_CODE,B2_CUSTOMER_PASSWORD,MCP_API_KEY&envDescription=B2クラウドの認証情報とMCPアクセスキー)
```

---

## 付録A: テスト認証情報

```
お客様コード: 0482540070
パスワード: mimimi555
B2クラウドURL: newb2web.kuronekoyamato.co.jp（このアカウントの場合）
```

## 付録B: エラーコード一覧

→ 第6章 6-15節に全エラーコード（実機テスト収集分）を記載。

## 付録C: delivery_time_zone 定数

→ 第6章 **6-2-T節** に全コード（通常サービス用8コード + タイム専用2コード）を記載。

**クイック参照（完全な値は 6-2-T）:**

| 分類 | 値 |
|------|-----|
| 通常サービス（0/5/8/2/6/7/A/3/1） | `0000` / `0812` / `1214` / `1416` / `1618` / `1820` / `1921` / `2021` |
| タイム専用（4） | `0010` / `0017` のみ |

タイム便で通常用コード、または通常サービスでタイム用コードを指定すると `ES002038` エラー。

## 付録D: msgpackがデフォルトである理由

B2クラウドのフロントエンドJSは**1件の送り状でも**msgpack+zlib経由で送信している。JSONで全エンドポイントが動作することは実機テスト済みだが、以下の理由からmsgpackをデフォルトとする:

1. **サーバー設計の前提** — B2クラウドの本来のプロトコルがmsgpack+zlib。JSONは「たまたま受け付ける」だけの可能性がある
2. **サーバー負荷** — msgpackパスとJSONパスでは処理コストが異なる可能性。大量アクセスでの差が不明
3. **将来互換性** — ヤマトがJSON受付を閉じる可能性はゼロではない
4. **礼儀** — 他人のインフラを使う以上、本来のプロトコルに合わせるべき
5. **大量一括時の性能** — 5,000件で **JSON 4.7MB → msgpack+zlib 57KB、約82倍の圧縮**（実測、下表参照）

**JSON vs msgpack+zlib 圧縮性能（実機ブラウザで計測、同一送り元・類似宛先の業務データ）:**

| 件数 | JSON | msgpack+zlib | 圧縮率 | f2a+encode+zlib 処理時間（ms） |
|------|------|-------------|-------|-----------|
| 1件 | 994B | 268B | 27.0% | 初回44ms（オーバーヘッド含む） |
| 10件 | 9.8KB | 422B | 4.3% | 5ms |
| 50件 | 48.9KB | 1.0KB | 2.0% | 6ms |
| 100件 | 97.8KB | 1.6KB | 1.6% | 5ms |
| 500件 | 491KB | 6.4KB | 1.3% | 14ms |
| 1,000件 | 982KB | 12.2KB | 1.2% | 24ms |
| **5,000件** | **4.7MB** | **57.5KB** | **1.2%** | **125ms** |

**完全ランダムデータ（最悪ケース、1,000件）:**

| 件数 | JSON | msgpack+zlib | 圧縮率 |
|------|------|-------------|-------|
| 1,000件 (ランダム) | 1.0MB | 133KB | **12.9%** |

→ 典型的な業務データ（同じ依頼主情報・類似商品名）では **圧縮率 1〜2%** が実現される（JSON比 98% 削減）。完全ランダムでも 87% 削減。処理時間は 5,000件でも 125ms 程度で、実用上問題なし。

---

## 付録E: Node.js環境での検証状況

ブラウザ実機検証（Playwright-MCP経由）はほぼ完了しており、**2026-04-16 に Node.js 環境での E2E 検証**を実施。本付録はその結果を**検証済み**と**未検証**に分けて記録する。

### E-1. Node.js環境での基本挙動 — ✅ 検証完了（2026-04-16）

| # | 項目 | 結果 | 詳細 |
|---|------|:----:|------|
| 1 | Cookie多ドメインフロー（bmypageapi → bmypage → newb2web） | ✅ | `tough-cookie` + `undici` で3ドメイン跨ぎ動作、Step1の302を`redirect:'manual'`で手動追跡、5ホップまで |
| 2 | TLS cipher要件 | ✅ | Node.js デフォルト cipher で接続可能。Python版の `AES128-SHA` 強制指定は**不要** |
| 3 | **`Origin` / `Referer` / `X-Requested-With` ヘッダ必須性** | ✅ **必須確定** | 欠けると**`417 Expectation Failed`**。CSRF対策。4-9に反映済 |
| 4 | Connection keep-alive（Vercel warm invocation 時の接続再利用） | 🟡 未検証 | Vercel実機デプロイ後に計測予定 |

**検証コード:** `/home/claude/b2test/test-e1-auth.js` — **login-total 3〜5秒で完走**、Cookie計5個 (CSID, LG_TIME, SID × newb2web / SECURE_BIGip × bmypage / SECURE_BIGip × bmypageapi)

### E-2. msgpack圧縮パイプライン — 部分的に検証

| # | 項目 | 結果 | 詳細 |
|---|------|:----:|------|
| 5 | 大量一括（100/1000/5000件）の圧縮サイズ | ✅ | ブラウザ実機で 5,000件= 57KB、Node.js でも同等。付録D参照 |
| 6 | ネストオブジェクト（customer, invoice配列等）のエンコード | 🟡 | shipment 単独は動作確認、customer / invoice 配列のネストは未検証 |
| 7 | 長文字列（50+バイト、Unicode混在）のstr8/str16境界 | 🟡 | 境界値テスト未実施 |
| 7a | **msgpack テンプレートの取得先** | ✅ **判明** | `/tmp/template.dat` (base64, 460行) が正解。`/b2/d/_settings/template` (1115行) は f2a には使えない別物。3-4に反映済 |
| 7b | **t2m の t 配列の `author{}` 子要素定義** | ✅ **修正済** | `" name"/" uri"/" email"` (先頭スペース付き) が正。スペース無しだと entry idx が3個ズレる。2-3-6に反映済 |

### E-3. セッション/認証のエッジケース — 部分的に検証

| # | 項目 | 状態 | 詳細 |
|---|------|:----:|------|
| 8 | セッションタイムアウト時間 | 🔴高 未 | ログインから何分後に 401 が返るか。長時間テストが必要 |
| 9 | **401/403時の自動再ログイン** | ✅ **検証完了（2026-04-16）** | 無効Cookieで叩くと **HTTP 401** + body `{"feed":{"title":"Authentication error."}}` を返す。`b2Request` で検知し `onReauthenticate` コールバックで `login()` 再実行 → リトライで完全復旧を確認。`test-e3-9-reauth.js` 参照 |
| 10 | 並行リクエスト（同一セッションでの `Promise.all()`） | 🟡中 未 | 特に `/settings` の read-modify-write と伝票送信の競合 |
| 11 | テンプレートのキャッシュ期限 | 🟢低 未 | `/tmp/template.dat` がどの頻度で変わるか |
| 12 | MFA/CAPTCHA発生条件 | 🟡中 未 | 連続自動ログインでキャプチャが出るか |

### E-4. 削除系E2Eフロー — ✅ 部分的に検証完了（2026-04-16）

| # | 項目 | 結果 | 詳細 |
|---|------|:----:|------|
| 13 | `DELETE /b2/p/new`（保存済み伝票の削除） | ✅ **仕様確定** | ブラウザUIから 19件一括削除を Playwright で HARキャプチャ。**`DELETE /b2/p/new` (クエリなし)** + `Content-Type: application/x-msgpack; charset=x-user-defined` + `Content-Encoding: deflate` + msgpack+zlib body で成功。JSON body では NG（409またはno-op）。設計書 4-11 に仕様反映済み |
| 14 | `PUT /history?display_flg=0`（履歴の論理削除） | 🟡 **UI上は未提供** | B2クラウドの Web UI には「発行済み履歴の削除」ボタンが存在しないことを確認。元JSにも該当コードなし。API として動くかは未検証、実装時に必要なら追試 |

### E-5. Node.js 検証で新たに判明した項目

#### E-5-a. ✅ 検証完了（2026-04-16）

| # | 項目 | 結論 | 詳細 |
|---|------|:----:|------|
| 15 | **新規印刷時の `B2_OKURIJYO?checkonly=1` 必須性** | ✅ **新規でも必須** | 実機で**新規発行 3件×2条件**を検証。`checkonly=1` なしは 0/3（96B HTMLエラー）、ありは 3/3（106KB PDF）。設計書4-7を「新規/再印刷どちらでも必須」に訂正済み |
| 16 | **`search_key4` による 12桁追跡番号の取得トリガーと待ち時間** | ✅ **PDF取得が割当トリガー** | `polling Success` 時点では UMN内部番号のみ。`B2_OKURIJYO?checkonly=1 → fileonly=1` の PDF取得フロー自体が **12桁 tracking_number 割当の必須トリガー**。PDF取得後 **1.4〜2.6秒で取得可能**（実測 3/3）。PDF取得しなければ 30秒待っても 0/3 全滅 |
| 16-a | **`search_key4` の値制限** | ✅ **16文字以内・英数字のみ推奨** | 19文字で `ES002070`「検索キー4の内容が正しくありません」エラー。`_` を含む値で確認。マスタ定義上は 30文字だが、shipment の search_key は別制限ありと推定。本番では英数字16文字以内に |

**重要**: 15 と 16 は**同じAPIコール**（`B2_OKURIJYO?checkonly=1`）に関する発見。つまり、新規発行時のPDF取得は「単にPDFを取る」のではなく「**本番印刷確定 → tracking_number 正式割当 → PDF生成完了**」という3つのサーバー副作用を一度に起こす同期ポイント。

#### E-5-b. 未検証項目

| # | 項目 | 優先度 | 備考 |
|---|------|:------:|------|
| 17 | 複数Vercelインスタンス間でのセッション共有 | ⚪️不要 | **2026-04-16 ステートレス方針確定により対象外。** 各リクエストで新規ログインする実装に決定（API/MCP用途は単発呼び出し中心、3-5秒のログインオーバーヘッドは print フロー全体20秒に対して誤差範囲）。バッチ用途は将来 `/api/b2/batch` で1呼び出し内クロージャ方式により解決する。永続化（Redis/KV）は導入しない |
| 18 | `redirect: 'manual'` の挙動の undici/Node.js バージョン依存性 | 🟢低 | Node.js v22.22.2 / undici ^6.0 で動作確認、他バージョンは未検証 |
| 19 | `$.b2fetch` と `MPUploader` のレスポンス挙動差 | 🟡中 | 同一エンドポイントに到達、エラーハンドリングに差があるかは未確認 |
| 20 | PUT/DELETE のリトライ安全性 | 🟡中 | B2クラウドサーバー側の冪等性実装は未検証（例: 削除済み伝票への再DELETE） |

### E-6. 推奨検証スケジュール

**✅ 2026-04-16 の Node.js E2E 検証で実施済み:**
- E-1 #1,#2,#3（認証フロー、TLS、必須ヘッダ）
- E-2 #5,#7a,#7b（圧縮サイズ、テンプレートURL、author{}スペース）
- E-3 #9（自動再ログイン）
- E-4 #13（DELETE /new）、#14（履歴削除機能無しを確認）
- E-5 #15（PDF checkonly=1必須）、#16（追跡番号取得）、#16-a（search_key4制限）

**未検証、以下のタイミングで実施推奨:**

| タイミング | 実施項目 |
|-----------|---------|
| **実装 Phase 1 途中** | E-3 #8（セッションタイムアウト）— 発生頻度高、UX影響大 |
| **実装 Phase 1 完了後** | E-2 #6（ネスト），E-3 #10（並行），E-5 #17（複数Vercel），#19 |
| **リリース前 最終確認** | E-1 #4（keep-alive），E-2 #7（str境界），E-3 #11,#12，E-5 #18,#20 |

### E-7. Node.js 検証で使ったテストコード（リポジトリ参考）

`/home/claude/b2test/` 以下に保存、今後の検証で再利用可能:

| ファイル | 役割 | 主な発見 |
|---------|------|---------|
| `package.json` | `undici` ^6, `tough-cookie` ^5, `@msgpack/msgpack` ^3, `pako` ^2.1 の依存定義 | — |
| `src/msgpack-js.js` | f2a/e2a/t2m/t2m2/replaceControlCode の移植 | **`author{}` 子要素のスペース付き版が正** |
| `src/b2client.js` | login/b2Request/b2Get/b2Post/b2Put/b2GetBinary/compressFeed | **Origin/Referer/X-Requested-With ヘッダ必須**、5ホップまでのリダイレクト追跡、msgpack/JSON両対応 |
| `test-e1-auth.js` | E-1 認証フロー検証 | login-total 3〜5秒で完走 |
| `test-e2e.js` | E2E完走テスト (checkonly→save→print→polling→PDF→tracking) | 全パスのタイミング実測 |
| `test-headers.js` | 417エラー原因特定 | Origin/Refererが必須 |
| `test-real-template.js`, `test-real-template2.js` | テンプレートURL調査 | `/tmp/template.dat` (460行, base64) が正、`/b2/d/_settings/template` (1115行) は別物 |
| `test-msgpack-debug.js`, `test-mapping.js`, `test-entry-count.js`, `test-all-markers.js` | msgpackフィールドズレ原因調査 | `author{}` 子要素スペース問題 |
| `test-e15-pdf-checkonly.js` | **#15: PDF checkonly=1 の新規/再発行×有無マトリクス** | **新規でも checkonly=1 必須（0/3 → 3/3）** |
| `test-e16-tracking-wait.js` | **#16: 追跡番号取得の待ち時間計測** | PDF取得後 0秒で取得可能 |
| `test-e16b-hypothesis.js` | **#16 仮説検証**: PDF取得がtracking割当トリガーか | **PDF取得なし: 0/3、あり: 3/3 で確定** |
| `test-e3-9-reauth.js` | **#9: Cookie無効化→401応答→自動再ログイン→リトライ** | 401 `{"feed":{"title":"Authentication error."}}`、再ログインで完全復旧 |
| `test-e4-delete.js`, `test-e4-delete-variants.js`, `test-e4-delete-timing.js`, `test-e4-dump.js` | **#13: DELETE /new 検証（JSON bodyの各パターン）** | JSON body では全パターン no-op or 409 |
| (Playwright HARキャプチャ) | **#13: UI 削除ボタン押下の元JS挙動** | **DELETE /b2/p/new** (クエリなし) + **msgpack+zlib body** で 19件一括削除成功 |

---

---

## 付録F: 実機検証ログ

### F-1. 検証環境

- ブラウザ: Playwright-MCPコントロール下のChromium
- アカウント: お客様コード `0482540070`（株式会社レボル）
- 担当営業所: 川口飯塚営業所（コード124594）
- B2クラウドURL: `https://newb2web.kuronekoyamato.co.jp/`

### F-2. 完全E2E完走ログ

```
[Step 1] checkonly
POST /b2/p/new?checkonly
Response: error_flg="0" (完全正常), checked_date="2026-04-16 11:49:27"
所要時間: ~60ms

[Step 2] save
POST /b2/p/new
Body: {feed:{entry:[{shipment:{...shipment_flg:"0"...}}]}}
Response: tracking_number="UMN240309577" (内部管理番号)
         link[0].___href="/0482540070-/new/UMN240309577"
所要時間: ~200ms

[Step 3] get_saved (保存済み一覧から対象特定)
GET /b2/p/new?service_type=0
→ search_key4="TEST1776307799813" で特定
所要時間: ~100ms

[Step 4] print issue
POST /b2/p/new?issue&print_type=m5&sort1=service_type&sort2=created&sort3=created
Body: {
  feed: {
    entry: [{
      id: "/0482540070-/new/UMN240309577,1",   ★ id + link 両方必須
      link: [{"___href": "/0482540070-/new/UMN240309577", "___rel": "self"}],
      shipment: {..., shipment_flg:"1", printer_type:"1"}
    }]
  }
}
Response: feed.title="UMIN0001077958" (issue_no), feed.subtitle="100"
所要時間: ~300ms

[Step 5] polling
GET /b2/p/polling?issue_no=UMIN0001077958&service_no=interman
→ 1回目で feed.title="Success"
所要時間: ~500ms

[Step 6] PDF download
GET /b2/p/B2_OKURIJYO?issue_no=UMIN0001077958&fileonly=1
→ 106KB, 先頭4バイト "%PDF"
所要時間: ~300ms

[Step 7] tracking番号取得（リトライあり）
GET /b2/p/history?all&search_key4=TEST1776307799813
→ 1回目: tracking_number="" (未反映)
   ...
→ 18回目: tracking_number="389711074012" ★12桁ヤマト追跡番号取得
所要時間: ~18秒 (1秒間隔×18回)

合計所要時間: 約20秒
```

### F-3. entry構造の組み合わせ別テスト結果

同一保存済み伝票を異なる `print issue` entry構造で送信:

| テストケース | 結果 |
|------------|------|
| `{id, link, shipment}` 両方指定 | ✅ 200 OK, issue_no払い出し |
| `{id, shipment}` のみ | ❌ 409 Conflict |
| `{link, shipment}` のみ | ❌ 500 Server Error |
| `{shipment}` のみ | ❌ 500 Server Error |
| `{id(,revision無し), link, shipment}` | ❌ 500 Server Error |

**結論: `id`末尾の`,{revision}`と`link`配列の両方が揃って初めて成功する。**

### F-4. service_type × printer_type × print_type の完全マトリクス

PDFの中身を決める3軸すべてを実機検証した結果の詳細は、**本編の 5-2/5-3 および 5-3-2-B を参照**。ここでは元データ取得の経緯のみ記録する。

**検証アプローチ:**

| ラウンド | 検証内容 | 主結果 |
|---------|---------|--------|
| R1 | `service_type=0` (既存tracking=`487462947650`) × 異なるprint_type × レーザー設定 | `m5`以外は全てA4バイナリ同一（フォールバック） |
| R2 | `service_type=0` × 異なるprint_type × ラベル設定 | print_typeごとに異なる専用サイズ、`m5`/`5`/`6`は400 |
| R3 | 異なるservice_type × `print_type=m` × レーザー設定 | 同じA4でも中身完全に別物（5-3-1参照） |
| R4 | 異なるservice_type × 異なるprint_type × ラベル設定 | **9×11の完全マトリクスを確定**（5-3-2-B参照） |

**F-4-E. 総合発見:**

1. **PDFの中身を決める3軸**: `shipment.service_type` × `general_settings.printer_type` × `print_type`
2. **service_typeの影響が最大**: 伝票種別がPDFレイアウトを決める
3. **printer_typeの影響は用紙サイズ系**: A4 or ラベル専用サイズの切替
4. **print_typeは用紙バリエーション**: 同一service_type内でA4/A5切替や、ラベル設定時のレイアウトバリエーション（専用/共通）選択
5. **ラベル設定下で400 Error**: `m5`/`5`/`6`/`9`/`CP` は全service_type共通、さらに service_type が `3/5/8/9` なら全print_type NG
6. **画像数**: レーザー設定時は6枚程度、ラベル設定時はほぼ0（ベクタのみ）。例外: コンパクトはラベル設定でも1枚含む

### F-5. 再印刷PDFエラー再現

reissue直後のfileonly=1取得で発生したエラー:

```
GET /b2/p/B2_OKURIJYO?issue_no=UMIN0001111880&fileonly=1
→ Response: 96 bytes
  Content:
    <html>
    <script type="text/javascript">
    parent.location.href = "/sys_err.html"
    </script>
    </html>
```

**解決方法:** 事前に `GET /b2/p/B2_OKURIJYO?checkonly=1&issue_no=UMIN0001111880` を1回叩いてから取得 → 107KB の正常PDFが返る。

### F-6. invoice_* フィールドの正しい組み合わせ特定

`#select_invoice` の表示テキスト `"0482540070-    01"` を分解して内部値を特定:

```javascript
// B2クラウド元JS (main-9d4c7b2348.js) の getIssueData()実行結果
{
  invoice_code: "0482540070",       // お客様コード10桁
  invoice_code_ext: "",              // ★空文字が正解
  invoice_freight_no: "01",          // ★枝番はここ
  invoice_name: ""                   // 請求先表示名（空OK）
}
```

**Pythonコードとの差異:**
- Python: `invoice_code_ext="01"` → ES006002「請求先が存在しません」
- 正解: `invoice_code_ext=""`, `invoice_freight_no="01"`

### F-7. アカウント情報（実機取得）

`customer` オブジェクトの実際の値（initdisplay経由では Access denied、checkonly レスポンス内から取得）:

```json
{
  "customer_code": "0482540070",
  "customer_code_ext": "",
  "customer_name": "株式会社レボル",
  "customer_center_code": "124594",
  "sorting_code": "0300441",
  "login_username": "林 亜紗実",
  "eazy_cd": "0",
  "nohin_cd": "0",
  "levelup_cd": "0",
  "api_user_cd": "9",
  "is_kuroneko_yupacket": "1",
  "invoice": [
    {
      "invoice_code": "0482540070",
      "invoice_code_ext": "",
      "invoice_freight_no": "01",
      "invoice_name": "",
      "is_collect": "1",
      "is_using_credit_card": "02",
      "is_receiving_agent": "00",
      "is_using_qrcode": "00",
      "is_using_electronic_money": "02",
      "payment": [{"payment_number": ""}]
    }
  ]
}
```

### F-8. 検証で使用したサンプルコード

→ **本編 4-8 `createAndPrint()` が実機検証済みの完全版**。付録Fでの検証もほぼ同じ手順（`checkonly → save → get_saved → print_issue → polling → PDF → tracking`）で実施。

**検証時のブラウザコンソール実行手順（参考）:**

1. ブラウザを B2クラウド にログイン済みの状態にする
2. Playwright-MCP の `browser_evaluate` で `fetch('/b2/p/new?checkonly', {...})` を直接呼び出し
3. レスポンスの `feed.entry[0].error` を確認
4. 成功すれば `shipment_flg='0'` を付けて `fetch('/b2/p/new', {...})` で保存
5. 以降、4-8 と同じ手順

Node.js からの実装では `undici` + `tough-cookie` を使って Cookie を継続的に管理し、各エンドポイントへ手動でリクエストする。msgpack パイプラインは 2-3-5 の `compressFeed()` を利用。

---

**本設計書は実機検証完了済み。Claude Code による自律実装が可能な状態。**
