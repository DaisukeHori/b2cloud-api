import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
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
    servers: [
      {
        url: '/',
        description: 'Current server',
      },
    ],
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
          description: 'API key via header X-MCP-API-Key',
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
 * Vercel は npm パッケージの CSS を serve できないため、CDN から読み込む。
 */
export function mountSwagger(app: Express): void {
  const uiOptions = {
    customCssUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui.css',
  };
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, uiOptions));

  // OpenAPI spec を JSON で取得可能にする
  app.get('/api/docs.json', (_req, res) => {
    res.json(spec);
  });
}
