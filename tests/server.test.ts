/**
 * server.ts テスト — MCP SDK サーバー生成の整合性
 */

import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server';

describe('createServer', () => {
  it('McpServer が生成できる', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
