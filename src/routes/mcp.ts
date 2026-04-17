import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../server';
import { checkApiKey } from '../middleware/api-key';

const router = Router();

/**
 * GET /api/mcp — Health check（認証不要）
 */
router.get('/', (_req, res) => {
  res.json({
    name: 'b2cloud-api',
    version: '0.1.0',
    status: 'ok',
    tools: 12,
  });
});

/**
 * POST /api/mcp — MCP SDK StreamableHTTPServerTransport
 */
router.post('/', async (req, res) => {
  // API キー認証（MCP 独自チェック、session middleware は不要）
  if (!checkApiKey(req)) {
    res.status(401).json({
      error: 'Unauthorized',
      message:
        'API key required. Pass via query parameter ?key=xxx or header X-MCP-API-Key.',
    });
    return;
  }

  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP handler error:', err);
    if (!res.headersSent) {
      const message =
        err instanceof Error ? err.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  }
});

export default router;
