# b2cloud-api — Claude Code ガイダンス

このファイルは Claude Code が最初に読むべきプロジェクト固有の指示です。

---

## 🎯 プロジェクトの目的

ヤマト運輸「送り状発行システム B2クラウド」の TypeScript / Vercel Serverless 製 API・MCPサーバー。ブラウザで動作する公式UIと完全互換のプロトコルを実装し、Claude や他の LLM から伝票作成・印刷・追跡番号取得・削除を自動化できるようにする。

対象リポジトリ: `DaisukeHori/b2cloud-api`
デプロイ先: Vercel（ワンボタンデプロイ対応）

---

## 🚨 絶対に最初にやること

**何を実装する前でも、まず `docs/b2cloud-design.md` を全部読む。**

この設計書は 3,364行 / 170KB の完全仕様書で、**2026-04-16 の Node.js E2E実装検証で得られた実機確定情報が網羅されている**。推測ベースの実装は一切不要・有害。設計書に書かれている「★」「✅」マーク付きの事項は全て実機で踏んだ落とし穴または検証済み事実。

**特に以下の6節は実装前に必ず読む:**

1. **1-3** 通信プロトコル: JSON と msgpack+zlib の使い分け（設計書初期版の「msgpack デフォルト」は誤りで訂正済み）
2. **3-4** テンプレート取得は `/tmp/template.dat` (base64, 460行)。`/b2/d/_settings/template` (1115行) とは別物
3. **4-7** PDF取得と `checkonly=1` の必須性、12桁追跡番号割当トリガー
4. **4-9** HTTPクライアント必須ヘッダ (Origin/Referer/X-Requested-With)、DELETE時 msgpack 自動強制
5. **4-10** Node.js E2E検証結果と 6つの落とし穴
6. **4-11** DELETE フロー（msgpack+zlib 必須、JSON body は 409 or no-op）

---

## ⚠️ 必ず避けるべき落とし穴（実機で踏んだもの）

### プロトコル関連
1. **Origin + Referer + X-Requested-With ヘッダを忘れない** — 欠けると `417 Expectation Failed`
2. **テンプレートURLを間違えない** — `/tmp/template.dat` が正、base64 decode して 460行の配列にする
3. **`t2m` の `t` 配列の `author{}` 配下は先頭スペース付き** — `" name"`, `" uri"`, `" email"` スペース無しだと entry idx が 3個ズレる
4. **302 リダイレクトは `redirect: 'manual'` で手動追跡** — fetch 自動リダイレクトだと Cookie が途中で失われる

### 伝票発行関連
5. **PDF取得は必ず `checkonly=1` → `fileonly=1` の2段階** — 新規印刷でも `checkonly=1` 無しだと 96B HTMLエラー (0/3 失敗)
6. **polling Success だけでは tracking_number は UMN 内部番号のまま** — PDF取得フローが 12桁割当のトリガー
7. **`search_key4` は 16文字以内・英数字** — 19文字や記号で `ES002070` エラー
8. **追跡番号取得は PDF取得後 1.4〜2.6秒で可能**、retry は 30秒まで

### DELETE 関連
9. **`DELETE /b2/p/new` は msgpack+zlib body 必須** — JSON body では 409 or 200だが実削除されない
10. **`PUT /history?display_flg=0` は UI にもAPIにも機能存在なし** — 発行済み伝票は削除不可が仕様

### msgpack 関連
11. **`$.b2fetch` は JSON を送る、`MPUploader` が msgpack+zlib** — 設計書初期版の逆
12. **msgpack バイト列は zlib compress 後 `subarray(2, -4)` で raw deflate にする** — header/footer を剥がす

---

## 📦 技術スタック（設計書 1-5 参照）

| 領域 | 選定 |
|------|------|
| 言語 | TypeScript (strict: true) |
| ランタイム | Node.js 22.x (Vercel) |
| HTTP | `undici` ^6.0 |
| Cookie | `tough-cookie` ^5.0 |
| msgpack | `@msgpack/msgpack` ^3 |
| zlib | `pako` ^2.1 (raw deflate) |
| MCP | `@modelcontextprotocol/sdk` |
| テスト | `vitest` |

**Python は使わない。** 元リポジトリが Python だが、バグ12件のうち4件は重大（設計書10章参照）、JS ベース移植が正解。

---

## 🗂 ディレクトリ構造（設計書 2-1 参照）

```
src/
├── types.ts           # Shipment / Feed / Session 型定義 (2-4)
├── msgpack.ts         # f2a / e2a / t2m / t2m2 / replaceControlCode (2-3)
├── b2client.ts        # login, b2Request, b2Get/Post/Put/Delete (4-9)
├── createAndPrint.ts  # 高レベルAPI (4-8)
├── api/               # Vercel Serverless Functions (REST API)
│   └── b2/
│       ├── login.ts
│       ├── check.ts
│       ├── print.ts
│       ├── reprint.ts
│       ├── pdf.ts
│       ├── saved.ts
│       └── history.ts
├── mcp/
│   └── server.ts      # MCP Tools (9章)
└── utils/
    └── cookies.ts
docs/
└── b2cloud-design.md  # 🔥 全仕様書、実装前必読
```

---

## 🛠 重要なコマンド

```bash
# 依存インストール
npm install

# 型チェック
npm run typecheck     # tsc --noEmit

# テスト
npm test              # vitest run
npm run test:e2e      # E2E（実B2クラウドに接続、.env 必須）

# ローカル開発
npm run dev           # vercel dev

# デプロイ
vercel --prod

# リント
npm run lint
```

---

## 🧪 実機検証用コード

**`/home/claude/b2test/` に Node.js で書かれた検証コードが残っている**（開発者のローカル環境）。新規の仕様確認が必要になった場合は、このディレクトリのパターンを参考に新規テストを書く。既存ファイル:

- `src/msgpack-js.js` — f2a/e2a/t2m/t2m2 の移植、`author{}` 子要素スペース付き版
- `src/b2client.js` — login/b2Request/b2Get/b2Post/b2Put/b2GetBinary（CSRFヘッダ自動付与）
- `test-e1-auth.js` — 認証フロー検証
- `test-e2e.js` — E2E完走テスト (JSON/msgpack両パス)
- `test-e15-pdf-checkonly.js` — PDF checkonly=1 必須性
- `test-e16*.js` — 追跡番号取得トリガー検証
- `test-e3-9-reauth.js` — 401自動再ログイン
- `test-e4-delete*.js` — DELETE 仕様探索

TypeScript 実装後、これらを TypeScript に移植して `tests/` 以下に置くのも可。

---

## 📚 移植元の元JS（reference/original-js/）

**リポジトリ内の `reference/original-js/` に B2クラウド公式ブラウザUIの実配信 JS 3ファイルが入っている**。移植作業で挙動確認したい時はここを `grep` する。

| ファイル | 役割 |
|---------|------|
| `main-9d4c7b2348.js` (415KB) | **★最重要**: `f2a`/`e2a`/`t2m`/`t2m2`、`MPUploader`、`$.b2fetch`、`___template`、`FIELD_PATTERN`、`CONTROL_CODE`、`B2VALIDATOR`、エラーコード定数など、B2クラウド固有ロジック全て |
| `vdr-3ee93e23a5.js` (341KB) | jQuery 本体（移植では `undici` + `tough-cookie` で代替） |
| `vdr2-3010403877.js` (501KB) | msgpack、zlib_asm 等のライブラリ集（移植では `@msgpack/msgpack` + `pako` で代替） |

**使い方:** `reference/original-js/README.md` に `grep`/Python での抜き出しパターンが書いてある。minify 済みのため直接 `cat` せず、キーワード検索 → バイトオフセット切り出しで読む。

**著作権:** ヤマト運輸保有。**参考資料として含むのみで再配布不可**。詳細は `reference/original-js/README.md` の冒頭参照。

---

## 📝 コーディング規約

### スタイル
- **コメントは日本語で書く** — 設計書が日本語で統一されているため、整合性を保つ
- **関数 JSDoc は必須** — 特に設計書の該当セクション番号を参照する（例: `@see 4-7 PDF取得の2段構え`）
- **エラークラスは `src/types.ts` で定義** — `B2ServerError`, `ValidationError`, `SessionExpiredError` 等
- **型は any を避ける** — どうしても必要な場合は理由をコメントで説明

### 設計原則
- **低レベルAPI は設計書の挙動を忠実に再現** — 独自の抽象化は中レベル以上で
- **冪等性を意識** — session 再ログインは b2Request 内で自動化、呼び出し側は気にしない
- **失敗は早く、明確に** — エラーには設計書のエラーコードまたはセクション番号を含める

### 実装アプローチ
1. まず設計書の該当セクションを読む
2. `/home/claude/b2test/` に同等のJSコードがあれば確認
3. TypeScript に移植（型付き、エラーハンドリング付き）
4. ユニットテスト → E2Eテスト

---

## 🔐 認証情報

`.env.example` をコピーして `.env` に実値を入れる。テスト用アカウント（検証専用）:

```
B2_CUSTOMER_CODE=0482540070
B2_CUSTOMER_PASSWORD=mimimi555
```

---

## 🌀 ステートレス方針（重要）

**セッション管理層は持たない。各リクエストで新規ログインする。**

### なぜ
1. **Vercel Serverless はステートレスが哲学** — インスタンス間で `Map` 等のメモリ状態は共有不可
2. **設計書 E-3 #8 (セッションタイムアウト時間) と E-5 #17 (複数インスタンス共有) が未検証** — 推測ベースで永続化するのは危険、お客様コードロックのリスクあり
3. **ログイン3-5秒のオーバーヘッドは create_and_print 全体20秒に対して誤差範囲**
4. **MCP/REST 利用は単発呼び出し中心** — バッチ処理ニーズは出ていない

### 影響
- `src/session-store.ts` は**作らない**（過去存在したが削除済み）
- `api/_lib.ts` の `getSessionFromRequest` は毎回 `await login(config)` を実行
- `src/auth.ts` に `resolveLoginConfig` (環境変数 + ヘッダから LoginConfig 解決) がある
- `b2client.ts` の `onReauthenticate` コールバックは「**1リクエスト処理中**にCookieが失効した時の救済策」として残す（リクエスト跨ぎではない）

### 将来バッチ処理ニーズが出た時
- `/api/b2/batch` のような専用エンドポイントを作り、**1呼び出し内のクロージャでセッションを共有**する設計
- 個別エンドポイントは常にステートレスを保つ
- 永続化（Redis/KV/Supabase）は導入しない

---

**⚠️ コードに直接書かない。必ず `process.env` 経由で使う。**
**⚠️ 実運用時は別アカウントを使う。上記は株式会社レボルの開発検証用。**

---

## 📤 Git コミット規約

- **コミットメッセージは日本語**
- **プレフィックス**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- **1コミット = 1論理的変更**
- **設計書の該当セクション番号を本文に書く** — 例: `実装: 4-7 再印刷フロー`
- **git email は `nvidia.homeftp.net@gmail.com`** — `daisuke@revol.co.jp` は Vercel デプロイで弾かれる

```bash
git config user.email "nvidia.homeftp.net@gmail.com"
git config user.name "Daisuke Hori"
```

---

## 🔀 PR 作成 & オートマージのルール

**PR を作ったら必ず auto-merge を有効化する。**

1. `mcp__github__create_pull_request` で PR 作成
2. 直後に `mcp__github__enable_pr_auto_merge` を **必ず呼ぶ**（`mergeMethod: "SQUASH"` 推奨）
3. CI が既に緑なら auto-merge は「clean status」エラーを返すので、`mcp__github__merge_pull_request`（squash）で直接マージにフォールバック
4. マージ後はローカルで `git checkout main && git pull` を実行して状態を同期

### リポジトリ側の前提条件

リポジトリ **Settings → General → Pull Requests** で以下が ON になっている必要あり:

- ☑ **Allow auto-merge**
- ☑ **Allow squash merging**
- ☑ **Automatically delete head branches**（推奨）

これらは GitHub API では変更できないため、初回のみブラウザで設定する。

---

## 🎯 次にやること（Phase 1 MVP）

設計書 11章 の実装計画参照:

### Phase 1（1-2日目安）
1. `src/types.ts` — 型定義（設計書 2-4）
2. `src/msgpack.ts` — f2a/e2a/t2m/t2m2 移植（設計書 2-3）
3. `src/b2client.ts` — login / b2Request（設計書 4-9）
4. `src/createAndPrint.ts` — 高レベルAPI（設計書 4-8）
5. Vercel Serverless Functions 化（設計書 8章）
6. MCP Server 化（設計書 9章）

### 受け入れ基準
- [ ] `npm run typecheck` エラー0件
- [ ] `npm test` すべてパス
- [ ] 実機 E2E（test-e2e相当）が JSON/msgpack 両方で完走
- [ ] `DELETE /b2/p/new` が msgpack+zlib で動作
- [ ] PDF取得 → 追跡番号取得まで通る
- [ ] Vercel デプロイ成功、Deploy Button から新規プロジェクト作成可能

---

## 🆘 困ったら

1. **設計書を再度読む** — 多くの疑問は設計書に答えがある
2. **`/home/claude/b2test/`** の同等コードを確認
3. **ブラウザ実機と挙動比較** — Playwright MCP で B2クラウドUIを操作し、HAR キャプチャ
4. **付録E を見る** — 未検証項目がリストアップされている
5. どうしてもわからない場合、**設計書に「★未検証」コメントを書いて実装を保留**、ユーザーに確認を求める

---

**最終更新:** 2026-04-16（設計書 v1.5.0 対応）
