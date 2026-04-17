/**
 * POST /api/mcp
 *
 * MCP エンドポイント（@modelcontextprotocol/sdk 方式）
 * cloudflare-mcp / ssh-mcp と同じ StreamableHTTPServerTransport パターン。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../src/server';
import { handleCors, checkApiKey } from './_lib';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;

  // Health check
  if (req.method === 'GET') {
    res.status(200).json({
      name: 'b2cloud-api',
      version: '0.1.0',
      status: 'ok',
      tools: 12,
    });
    return;
  }

  // API key validation
  if (!checkApiKey(req)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Pass via query parameter ?key=xxx or header X-MCP-API-Key.',
    });
    return;
  }

  // MCP request handling
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
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  }
}
