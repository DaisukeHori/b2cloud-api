import cors from 'cors';

export const corsMiddleware = cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-B2-Customer-Code',
    'X-B2-Customer-Password',
    'X-B2-Customer-Cls-Code',
    'X-B2-Login-User-Id',
    'X-MCP-API-Key',
  ],
});
