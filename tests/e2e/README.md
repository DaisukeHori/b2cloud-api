# E2E テスト

実 B2クラウド (`newb2web.kuronekoyamato.co.jp`) に接続して動作検証する E2E テスト一式。

## 二段ガードの仕組み

誤実行を防ぐため、E2E テストはデフォルトで **必ずスキップ** されます。実行するには環境変数を明示する必要があります。

| 環境変数 | 役割 | 副作用 |
|---|---|:----:|
| `B2_CUSTOMER_CODE` + `B2_CUSTOMER_PASSWORD` | 認証情報。`.env` 経由で読み込み | なし |
| `B2_E2E_ENABLED=1` | 軽量 E2E（auth / check / save / delete）を有効化 | B2クラウドに保存→削除のみ、発行はしない |
| `B2_E2E_FULL=1` | フル E2E（**実発行**）を有効化 | **★12桁追跡番号が発行される、印刷ジョブが残る★** |

## ファイル構成

| ファイル | 内容 | 必要フラグ |
|---|---|---|
| `setup.ts` | `.env` 読み込み・ガード判定ヘルパー・テスト用伝票データ | — |
| `auth.e2e.test.ts` | 4段階ログイン・テンプレート取得・reauthenticate | `B2_E2E_ENABLED=1` |
| `b2client.e2e.test.ts` | CSRF/JSON/バリデーション/再認証 | `B2_E2E_ENABLED=1` |
| `shipment.e2e.test.ts` | check/save/list/find/delete のフロー（印刷しない） | `B2_E2E_ENABLED=1` |
| `print.e2e.test.ts` | createAndPrint / reprintFullFlow（**実発行**） | `B2_E2E_FULL=1` |

## 実行コマンド

```bash
# 1. .env の準備
cp .env.example .env
# B2_CUSTOMER_CODE / B2_CUSTOMER_PASSWORD を実値に書き換える

# 2. 軽量 E2E（B2クラウドに保存→削除のみ、発行しない）
B2_E2E_ENABLED=1 npm run test:e2e

# 3. フル E2E（★実印刷ジョブを発行★）
B2_E2E_ENABLED=1 B2_E2E_FULL=1 npm run test:e2e:full
```

## テストデータの安全性

`tests/e2e/setup.ts` の `getTestConsignee()` は環境変数 `B2_TEST_CONSIGNEE_*` で
お届け先住所を上書き可能。**フル E2E を試す場合は `B2_TEST_CONSIGNEE_*` を必ず
自社住所に設定**してください。デフォルトのテスト住所は永田町1-7-1（国会議事堂）
ですが、実際に発送されることを意図したものではありません。

## CI での扱い

- 通常の `npm test` は `vitest.config.ts` で `tests/e2e/**` を除外
- E2E は `vitest.e2e.config.ts` で別実行
- `B2_E2E_ENABLED` / `B2_E2E_FULL` は CI シークレットには登録**しない**運用を推奨
  （誤って大量印刷ジョブが走ると業務影響）
- ローカル開発時のみ `.env` で有効化

## トラブルシューティング

### `認証情報が設定されていません` エラー
→ `.env` に `B2_CUSTOMER_CODE` と `B2_CUSTOMER_PASSWORD` を書く

### `Login failed at Step 1` エラー
→ 認証情報が間違っている、または B2クラウド側でアカウントロックの可能性。
ブラウザで https://bmypage.kuronekoyamato.co.jp にログインできるか確認

### フル E2E でタイムアウト
→ `vitest.e2e.config.ts` の `testTimeout: 90_000` を伸ばすか、追跡番号取得の
リトライ待機が想定より長い可能性。設計書 E-5 #16 では 1.4〜2.6秒で取得とあるが
時間帯によっては数十秒かかる場合あり

### `ES002070` エラー
→ `search_key4` の制限超過 (16文字以内・英数字のみ)。`generateUniqueKey()` を
使えば自動で制限内に収まる
