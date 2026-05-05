import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import type { IncomingMessage, ServerResponse } from "node:http";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      // Mirror the /blossom-proxy Worker endpoint for local dev.
      // In production the Cloudflare Worker handles this route.
      // Here Node.js makes the upstream fetch — no browser CORS applies.
      '/blossom-proxy': {
        target: 'http://localhost:8080', // not used — handled by configure
        bypass(req: IncomingMessage, res: ServerResponse) {
          const reqUrl = new URL(req.url ?? '', 'http://localhost');
          if (req.method !== 'PUT') return null;

          // Accept ?url= (full URL) or legacy ?server= (base + /upload)
          const urlParam = reqUrl.searchParams.get('url');
          const serverParam = reqUrl.searchParams.get('server');

          let uploadUrl: string;
          if (urlParam) {
            try { uploadUrl = decodeURIComponent(urlParam); }
            catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid ?url= parameter' }));
              return false as unknown as string;
            }
          } else if (serverParam) {
            try { uploadUrl = decodeURIComponent(serverParam).replace(/\/+$/, '') + '/upload'; }
            catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid ?server= parameter' }));
              return false as unknown as string;
            }
          } else {
            return null;
          }

          if (!uploadUrl.startsWith('https://')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Upload URL must use https://' }));
            return false as unknown as string;
          }

          const chunks: Buffer[] = [];

          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', async () => {
            const body = Buffer.concat(chunks);
            const headers: Record<string, string> = {
              'Content-Type': req.headers['content-type'] ?? 'application/octet-stream',
              'Content-Length': String(body.length),
            };
            if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'] as string;
            if (req.headers['x-sha-256']) headers['X-SHA-256'] = req.headers['x-sha-256'] as string;

            try {
              const upstream = await fetch(uploadUrl, { method: 'PUT', headers, body });
              const upstreamBody = await upstream.arrayBuffer();
              res.writeHead(upstream.status, {
                'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(Buffer.from(upstreamBody));
            } catch (err) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Upstream failed: ${(err as Error).message}` }));
            }
          });

          return false as unknown as string;
        },
      },
    },
  },
  plugins: [
    react(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    onConsoleLog(log) {
      return !log.includes("React Router Future Flag Warning");
    },
    env: {
      DEBUG_PRINT_LIMIT: '0', // Suppress DOM output that exceeds AI context windows
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));