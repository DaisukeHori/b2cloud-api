/**
 * POST /api/mcp
 *
 * MCP (Model Context Protocol) エンドポイント（JSON-RPC over HTTP、非永続接続モード）
 *
 * Vercel Serverless の制約上、永続 SSE コネクションは維持しにくいため、
 * **非永続 JSON-RPC モード** で実装:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *
 * 各リクエストは独立しており、セッションは API Key (X-MCP-API-Key) + 環境変数由来の
 * B2 認証情報で起動される。
 *
 * @see 設計書 9章
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import {
  handleCors,
  checkMethod,
  checkApiKey,
  getSessionFromRequest,
  sendError,
  getBody,
} from './_lib';
import { MCP_TOOLS } from '../src/mcp-tools';

// ============================================================
// JSON-RPC 処理
// ============================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: any;
}

function jsonRpcResult(id: any, result: any): any {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: any, code: number, message: string): any {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ============================================================
// ツール → JSONSchema 変換（MCP SDK 互換の tools/list 用）
// ============================================================

function toJsonSchema(schema: z.ZodTypeAny): any {
  // 簡易実装: object の shape を JSON Schema に変換
  try {
    const def: any = (schema as any)._def;
    if (def?.typeName === 'ZodObject') {
      const shape: Record<string, any> = def.shape();
      const props: Record<string, any> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(shape)) {
        props[key] = { type: 'string' }; // 簡易: 全て string として公開
        const v = val as z.ZodTypeAny;
        const isOptional =
          (v as any)._def?.typeName === 'ZodOptional' ||
          (v as any)._def?.typeName === 'ZodDefault';
        if (!isOptional) required.push(key);
      }
      return {
        type: 'object',
        properties: props,
        required,
        additionalProperties: true,
      };
    }
  } catch {
    // 失敗時は空スキーマ
  }
  return { type: 'object', additionalProperties: true };
}

// ============================================================
// ハンドラ本体
// ============================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (!checkMethod(req, res, ['POST'])) return;

  if (!checkApiKey(req)) {
    res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Invalid or missing X-MCP-API-Key' },
    });
    return;
  }

  const body = getBody(req) as JsonRpcRequest;

  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    res.status(400).json(jsonRpcError(null, -32600, 'Invalid JSON-RPC request'));
    return;
  }

  const reqId = body.id ?? null;

  try {
    switch (body.method) {
      case 'initialize': {
        res.status(200).json(
          jsonRpcResult(reqId, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'b2cloud-api', version: '0.1.0' },
          })
        );
        return;
      }

      case 'tools/list': {
        res.status(200).json(
          jsonRpcResult(reqId, {
            tools: MCP_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: toJsonSchema(t.inputSchema),
            })),
          })
        );
        return;
      }

      case 'tools/call': {
        const params = body.params as
          | { name?: string; arguments?: any }
          | undefined;
        if (!params?.name) {
          res.status(200).json(
            jsonRpcError(reqId, -32602, 'tools/call: name required')
          );
          return;
        }
        const tool = MCP_TOOLS.find((t) => t.name === params.name);
        if (!tool) {
          res
            .status(200)
            .json(jsonRpcError(reqId, -32602, `Unknown tool: ${params.name}`));
          return;
        }

        const session = await getSessionFromRequest(req);
        const result = await tool.handler(session, params.arguments ?? {});
        res.status(200).json(jsonRpcResult(reqId, result));
        return;
      }

      default:
        res
          .status(200)
          .json(jsonRpcError(reqId, -32601, `Method not found: ${body.method}`));
        return;
    }
  } catch (e) {
    // MCP エラーとして 200 で返す（JSON-RPC 規約）
    res.status(200).json(
      jsonRpcError(
        reqId,
        -32603,
        e instanceof Error ? e.message : String(e)
      )
    );
  }
}
