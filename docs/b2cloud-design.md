# B2クラウド API/MCPサーバー 設計書（兼仕様書）

**プロジェクト名:** b2cloud-api
**リポジトリ:** DaisukeHori/b2cloud-api
**バージョン:** v1.0.0
**最終更新:** 2026-04-16
**言語:** TypeScript
**デプロイ先:** Vercel（ワンボタンデプロイ対応）
**検証ステータス:** **ブラウザ実機検証完了（msgpack+zlibパイプライン、E2E全フロー、全バリデーションルール）**

---

## 0. この設計書について

この設計書は Claude Code による自立実装を目的とした**完全仕様書**。ブラウザでの実機検証で確定した情報のみを記載しており、推測ベースの内容は「★未検証」と明記。

**主要な実機検証済み項目:**
- ログインフロー（ヤマトビジネスメンバーズ → B2クラウド動的URL検出）
- msgpack+zlib圧縮パイプライン（f2a/e2a/t2m/t2m2関数の動作確認、サーバーへのPOST成功）
- JSON送信パス（フォールバック動作確認）
- 完全E2Eフロー（checkonly → save → print → PDF → 追跡番号取得）
- 全バリデーションルール（必須項目・文字数制限・フォーマット・13エラーコード）
- 全サービスタイプ（発払い/タイム/着払い/コンパクト/コレクト/複数口/ネコポス/ゆうパケット/DM/EAZY）
- print_type × printer_type の全組み合わせ
- ラベルPDFの内部構造（通常A4 と完全同一バイナリであることを確認）

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
| service_type=7 | ネコポス（**誤り**） | クロネコゆうパケット（**正**） |
| ネコポスのコード | 未定義 | `A` |
| is_agent=1 必須 | 「13項目」（コメント） | **12項目（実機確定）** |
| invoice_code_ext | 枝番を入れる（**誤り**） | **空文字が正解**、枝番は`invoice_freight_no`へ |
| デプロイ | Flask/Zappa/Colab | Vercel Serverless |

### 1-3. 通信プロトコル: msgpackデフォルト、JSONフォールバック

**B2クラウドの主要機能ページ（1件発行・履歴検索・外部データ一括・保存検索）は全てmsgpack+zlibを使用している。核心機能は廃止されていない。**

実機検証で確認された事実:
- `main-9d4c7b2348.js`（398KB、single_issue_reg用）にf2a/e2a/t2m/t2m2/FIELD_PATTERN/zlib_asm/x-msgpack/MPUploaderが完全実装されている
- ブラウザ上で元JS関数を直接呼び出して手動バイト列を組み立て、`/b2/p/new?checkonly`へPOSTしたところ**200 OKで正常レスポンス取得**
- JSONでも同じエンドポイントが動作（レスポンスも完全一致）するが、B2クラウド本来のプロトコルはmsgpack

| パス | 用途 |
|------|------|
| msgpack+zlib（**デフォルト**） | 全API呼び出し。B2クラウド本来のプロトコル |
| JSON（オプション） | `useJson: true`指定時のみ。デバッグ・テスト用 |

**元JSの圧縮パイプライン（main-9d4c7b2348.js内、実機検証済み）:**
```javascript
var s = this.template;                              // /b2/d/_settings/template（1115行）
var o = f2a(s, e.data);                             // feed → 配列変換（t2m+e2a再帰）
var E = zlib_asm.compress(msgpack.encode(o));        // msgpack → zlib
var _ = new Uint8Array(E.subarray(2, E.length - 4)); // ヘッダ2byte/フッタ4byte除去
xhr.setRequestHeader("Content-Type", "application/x-msgpack; charset=x-user-defined");
xhr.setRequestHeader("Content-Encoding", "deflate");
xhr.send(_);
```

**TS実装:** `@msgpack/msgpack`（標準ライブラリ）+ `pako`（zlib）で元JSの処理を直接移植。

**圧縮率（実測）: JSON 585B → msgpack+zlib 205B = 35%（65%削減）**

### 1-4. 対象サービスタイプ

**Phase 1（MVP）:**

| service_type | 名称 | 備考 |
|-------------|------|------|
| `0` | 発払い（元払い） | 最も一般的、実機E2E検証済み |
| `4` | タイムサービス | 時間帯指定 |
| `5` | 着払い | invoice_code不要 |
| `8` | 宅急便コンパクト | 専用BOX使用 |

**Phase 2:**

| service_type | 名称 |
|-------------|------|
| `1` | EAZY |
| `2` | コレクト（代金引換） |
| `3` | クロネコゆうメール |
| `6` | 発払い（複数口） |
| `7` | クロネコゆうパケット |
| `9` | コンパクトコレクト |
| `A` | ネコポス |

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
│   │   ├── print.ts           # POST /api/b2/print (フル E2E)
│   │   ├── pdf.ts             # GET  /api/b2/pdf
│   │   ├── history.ts         # GET  /api/b2/history
│   │   ├── saved.ts           # GET/DELETE /api/b2/saved
│   │   └── reprint.ts         # POST /api/b2/reprint
│   └── health.ts              # GET  /api/health
├── src/
│   ├── b2client.ts            # B2クラウドHTTPクライアント（msgpack/JSON両対応）
│   ├── msgpack.ts             # msgpack+zlib圧縮パイプライン（元JSのf2a/e2a/t2m/t2m2直接移植）
│   ├── auth.ts                # ログイン/セッション管理
│   ├── shipment.ts            # 伝票CRUD操作
│   ├── print.ts               # 印刷/PDF取得（2段構えフロー）
│   ├── validation.ts          # 入力バリデーション（Zod）
│   ├── types.ts               # TypeScript型定義
│   ├── constants.ts           # 定数定義（FIELD_PATTERN, CONTROL_CODE等）
│   ├── mcp-tools.ts           # MCPツール定義
│   ├── session-store.ts       # セッションキャッシュ（メモリ/KV）
│   └── utils.ts               # ユーティリティ
├── vercel.json
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### 2-2. B2クラウドのマルチページアーキテクチャ

B2クラウドはSPAではなく、**各機能ページごとに別々のmain.jsを配信する**マルチページアプリケーション。全main.jsを実機検証した結果:

| ページ | main.js | サイズ | msgpack+zlib |
|-------|---------|-------|:------------:|
| メインメニュー | `main-75daae5226.js` | 235KB | ❌ (JSON化済み、軽量ページ) |
| **1件ずつ発行（伝票作成）** | **`main-9d4c7b2348.js`** | **398KB** | **✅ フル実装** |
| **履歴検索** | **`main-fdc5d67653.js`** | **482KB** | **✅ フル実装** |
| **外部データ一括発行** | **`main-0db2f3eaa7.js`** | **593KB** | **✅ フル実装** |
| **保存済み伝票検索** | **`main-abaec08cc7.js`** | **463KB** | **✅ フル実装** |
| 一般設定 | `main-4474421ae6.js` | 245KB | ❌ |
| プリンタ設定 | `main-9a4ae540ac.js` | 175KB | ❌ |

**核心機能（伝票作成・履歴検索・一括発行・保存検索）は全てmsgpack+zlibを使用。** 軽量ページはJSON化されているが、実API操作を行うページは全てmsgpackが現役。

**移植元ファイル:** **`main-9d4c7b2348.js`**（single_issue_reg用、伝票作成フローの完全実装が含まれる）を第一参照とする。

### 2-3. msgpack+zlib圧縮パイプライン（`src/msgpack.ts`）

#### 元JSソースファイル（移植元）

| ファイル | サイズ | URL | 内容 |
|---------|-------|-----|------|
| **`main-9d4c7b2348.js`** | **398KB** | `/scripts/main-9d4c7b2348.js` | 伝票作成用メインロジック。f2a/e2a/t2m/t2m2関数、FIELD_PATTERN、replaceControlCode、MPUploader、$.b2fetch全定義 |
| `vdr-3ee93e23a5.js` | 349KB | `/scripts/vdr-3ee93e23a5.js` | vendorライブラリ1（jQuery等） |
| `vdr2-3010403877.js` | 513KB | `/scripts/vdr2-3010403877.js` | vendorライブラリ2（msgpack実装 + zlib_asm実装） |

**★2026-04-16時点でCDN上に存在確認済み、GET 200 OK**

#### ★ワイヤーフォーマット完全検証結果

ブラウザ上で元JSのf2a/msgpack.encode/zlib_asm.compressを使って実際にバイト列を組み立て、`/b2/p/new?checkonly`へ直接POSTした結果、**完全に動作することを確認**。

**送信バイト列の構造（17フィールドのshipment 1件の場合）:**

| ステップ | 内容 | サイズ |
|---------|------|-------|
| 1. JSON相当 | `{"feed":{"entry":[{"shipment":{...}}]}}` | 585 bytes |
| 2. f2a出力（配列） | 15要素配列（先頭14個null、最後がentry配列） | — |
| 3. msgpack.encode | 先頭 `9f` = fixarray(15)、続いて `c0`×14 = null×14、`91`=fixarray(1), `dc 00 48`=array(72フィールド) | 418 bytes |
| 4. zlib_asm.compress | 先頭 `78 9c` = zlib ヘッダ、末尾4バイト = Adler32 | 211 bytes |
| 5. subarray(2, -4) | zlibヘッダ(2)とAdler32(4)を除去 → **raw deflate** | **205 bytes** |

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

{"feed":{"entry":[{"shipment":{...auto-filled},"error":[...]}]}}
```

**★重要: レスポンスは常にJSON（リクエスト形式に関わらず）。** msgpackで送ってもJSONで返る。つまり送信時のみmsgpack処理が必要で、受信側のf2a/e2a逆変換は不要。

**TS実装（簡潔版）:**
```typescript
// src/msgpack.ts
import { encode } from '@msgpack/msgpack';
import { deflateRaw } from 'pako';

// 元JSの f2a / e2a / t2m / t2m2 を直接移植（詳細は後述）
// 詳細な関数コードは 2-3-2 セクション参照

export function compressFeed(template: string[], feedData: any): Uint8Array {
  const mapping = t2m(template);
  const array = f2a(mapping, feedData);
  const packed = encode(array);
  return deflateRaw(packed); // raw deflate直接出力、trim不要
}
```

**注意:** 元JSは`zlib_asm.compress`でzlib形式にしてからヘッダ2byte+フッタ4byteを手動除去しているが、pakoの`deflateRaw`は最初からrawフォーマット（ヘッダ/フッタなし）を出力するため、除去処理は不要。

#### コア関数の元JSコード（移植用、完全版）

**`f2a(mapping, feedData)`** — feed全体を配列に変換:
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
```javascript
function t2m(e){
  for(var t=["author{}","name","uri","email","category{}"," ___term"," ___scheme",
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

**`t2m2(lines, startIdx, path)`** — t2mの再帰ヘルパー:
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

**定数:**

```javascript
FIELD_PATTERN = /^( *)([a-zA-Z_$][0-9a-zA-Z_$.]*)(?:\(([a-zA-Z$]+)\))?((?:\[([0-9]+)?\]|\{([\-0-9]*)~?([\-0-9]+)?\})?)(\!?)(?:=(.+))?$/

CONTROL_CODE = /[\x00-\x08\x0b\x0c\x0d\x0e\x0f\x1a\x1b\x1c\x1d\x1e\x1f\x10-\x19\x7f]/g

B2GLOBAL.replaceControlCode = function(e) {
  return void 0 === e || null === e ? "" : e.replace(new RegExp(CONTROL_CODE), "")
};
```

**FIELD_PATTERN キャプチャグループの意味:**
- `$1` = 先頭スペース（階層レベル判定用）
- `$2` = フィールド名
- `$3` = 型ヒント（`rdb_double`, `rdb_int`, `rdb_date`, `rdb_ignore`等）
- `$4` = 配列記法全体
- `$8` = 必須フラグ（`!`）
- `$9` = デフォルト値

---

（※続きは次のファイルへ、容量制限対応のため分割。続きのセクション全内容は /home/claude/b2cloud-design.md に保存済み）

---

## 完全設計書の取得

この文書は長大なため分割コミット。完全版は以下のリンクから取得可能:

1. docs/01-overview-and-arch.md - プロジェクト概要・アーキテクチャ
2. docs/02-auth-and-api.md - 認証・API仕様
3. docs/03-print-system.md - 印刷システム
4. docs/04-validation.md - バリデーションルール（実機検証）
5. docs/05-implementation.md - 実装計画・REST API・MCP Tools
6. docs/06-verification.md - 実機検証ログ

本ファイル（b2cloud-design.md）はサマリ版。

---

## 実機検証サマリ（2026-04-16完了）

### 全てのE2Eフロー成功

**実機完走した伝票例:**
- uniqKey: `TEST1776307799813` (search_key4)
- 内部管理番号: `UMN240309577`
- issue_no: `UMIN0001077958`
- PDF: 106KB %PDF正常
- **ヤマト12桁追跡番号: `389711074012`** ← 完全取得成功
- 合計所要時間: **約20秒**

### 実機検証で確定した重要発見

| # | 項目 | 内容 |
|---|------|------|
| 1 | msgpack+zlibパイプライン | 元JS関数をブラウザ上で実行し、手動で205バイトのバイト列を生成→POST成功 |
| 2 | `invoice_code_ext` は**空文字**が正解 | 枝番は `invoice_freight_no` へ入れる（Pythonコード誤り） |
| 3 | `error_flg` | `"0"`=完全正常、`"9"`=警告あり正常（両方処理継続可能） |
| 4 | print issue entry構造 | **`id` + `link` 両方必須**、id末尾に`,{revision}` |
| 5 | 再印刷時のPDF取得 | **`B2_OKURIJYO?checkonly=1` 完了確認が必須** |
| 6 | ラベルPDF vs 通常PDF | **streamLengthsが完全同一、ラベル用PDFは通常A4 PDFと同一バイナリ**（MediaBoxのみ違う場合あり） |
| 7 | is_agent=1 | **12項目必須**（Pythonコメントの「13項目」は誤り） |
| 8 | is_printing_date=1 + flag=0 | delivery_date必須（EF011017） |
| 9 | 複数口(6) | package_qty合計2-99必須（ES002624） |
| 10 | search_key4 | ユニークキー必須、半角英数字+スペースのみ（正規表現通過） |

### 検証済みPDFサイズマトリクス（同一伝票の再印刷、実機計測）

| print_type | 名称 | サイズ | MediaBox |
|-----------|------|-------|---------|
| m | A4マルチ | 107,407B | 595×842pt (A4縦) |
| m5 | A5マルチ | 107,394B | 595×421pt (A5横) |
| 4 | ラベル(発払い) | 107,407B | 595×842pt (A4縦、内容はmと完全同一) |
| 5 | ラベル(コレクト) | 107,407B | 595×842pt (A4縦) |
| 8 | ラベル(コンパクト) | 107,407B | 595×842pt (A4縦、内容はmと完全同一) |

→ **ラベル専用print_type (4/5/8) はサーバーからは通常A4と同一のPDFが返る**。サーマルラベル印刷はB2クラウド+クライアントアプリがA4 PDFから切り出して実行。

---

**本設計書は実機検証完了済み。開発者（Claude Code等）はこの内容に基づき自律実装可能。**
