import swaggerJsdoc from 'swagger-jsdoc';
import type { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'b2cloud-api',
      version: '0.1.0',
      description: `ヤマト運輸「送り状発行システム B2クラウド」を REST API / MCP サーバーから操作するための TypeScript API。

## 概要
宛先と品名の **8 フィールドだけ** で、送り状 PDF と 12桁追跡番号が返る。
依頼主（発送元）・請求先は環境変数でデフォルト設定済みのため、呼び出し側が意識する必要なし。

## 主要フロー
\`POST /api/b2/print\` 1回で以下を自動実行（約12秒）:
1. B2クラウドにログイン（5段階認証）
2. 送り状バリデーション（checkonly）
3. 送り状保存
4. 印刷ジョブ発行 + polling
5. PDF 取得（約100KB）
6. 12桁追跡番号取得

## 認証
- **API キー**: クエリパラメータ \`?key=xxx\` またはヘッダー \`X-MCP-API-Key\`
- **B2 ログイン情報**: 環境変数に設定済み。ヘッダー \`X-B2-Customer-Code\` / \`X-B2-Customer-Password\` で上書き可能

## 伝票種別（service_type）
| 値 | 名称 |
|---|---|
| 0 | 発払い（元払い）← 最も一般的 |
| 2 | コレクト（代金引換） |
| 3 | DM便 |
| 4 | タイムサービス |
| 5 | 着払い |
| 7 | クロネコゆうパケット |
| 8 | 宅急便コンパクト |
| A | ネコポス |

## PDF ダウンロード
送り状発行後、HMAC-SHA256 署名付きダウンロード URL（有効期限60秒）が返される。
\`GET /api/b2/download?tn={追跡番号}&exp={有効期限}&sig={署名}\` で PDF を取得可能。

## MCP サーバー
\`POST /api/mcp\` で MCP プロトコル（StreamableHTTP）に対応。
Claude / ChatGPT / Cursor 等から「送り状を出して」で即利用可能（12ツール）。

## 詳細ドキュメント
- [LP](https://daisukehori.github.io/b2cloud-api/)
- [設計書（3,364行）](https://github.com/DaisukeHori/b2cloud-api/blob/main/docs/b2cloud-design.md)
- [GitHub](https://github.com/DaisukeHori/b2cloud-api)`,
      license: {
        name: 'Apache 2.0',
        url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
      },
    },
    servers: [{ url: '/', description: 'Current server' }],
    components: {
      securitySchemes: {
        ApiKeyQuery: {
          type: 'apiKey',
          in: 'query',
          name: 'key',
          description: 'API key via query parameter ?key=xxx',
        },
        ApiKeyHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-MCP-API-Key',
          description: 'API key via header',
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './src/routes/*.js'],
};

const spec = swaggerJsdoc(options);

/**
 * Swagger UI を Express app にマウント
 *
 * Vercel は express.static() を無視するため、
 * swagger-ui-express の serve ミドルウェアが使えない。
 * CSS / JS を全て CDN から読み込むカスタム HTML を返す。
 */
export function mountSwagger(app: Express): void {
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2';

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>b2cloud-api — Swagger UI</title>
  <link rel="stylesheet" href="${CDN}/swagger-ui.min.css">
  <style>body { margin: 0; background: #fafafa; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${CDN}/swagger-ui-bundle.min.js"></script>
  <script>
    SwaggerUIBundle({
      spec: ${JSON.stringify(spec)},
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;

  app.get('/api/docs', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  app.get('/api/docs.json', (_req, res) => {
    res.json(spec);
  });
}
