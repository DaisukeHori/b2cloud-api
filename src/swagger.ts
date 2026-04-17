import swaggerJsdoc from 'swagger-jsdoc';
import type { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'b2cloud-api',
      version: '0.1.0',
      description:
        'ヤマト運輸 B2クラウドの送り状発行を REST API / MCP で自動化。宛先と品名だけで12桁追跡番号付きPDFが返る。',
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
