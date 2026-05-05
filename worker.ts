/**
 * Aeon — Cloudflare Worker
 *
 * Serves the static SPA via ASSETS binding, plus a /blossom-proxy endpoint
 * that forwards Blossom BUD-02 PUT /upload requests to the target server
 * server-side, bypassing browser CORS restrictions.
 *
 * Why a proxy is needed:
 *   All major Blossom servers do not include Access-Control-Allow-Origin
 *   headers on their OPTIONS preflight or PUT responses. Browsers block every
 *   direct upload attempt from cross-origin pages. Routing through this
 *   same-origin Worker endpoint eliminates the CORS issue entirely.
 *
 * Endpoint: PUT /blossom-proxy?url=<encoded-full-upload-url>
 *   - Forwards the entire request body to the full target URL
 *   - Passes Authorization, Content-Type, X-SHA-256, Content-Length through
 *   - Returns the Blossom server's JSON response (BlobDescriptor)
 *   - Injects CORS headers so the browser accepts the response
 *
 * The ?url= parameter is the full upload URL (e.g. https://server.com/upload
 * or https://server.com/blossom/upload for Pyramid servers).
 */

interface Env {
  ASSETS: Fetcher;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SHA-256, Content-Length',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight ────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Blossom upload proxy ──────────────────────────────────────────────
    if (url.pathname === '/blossom-proxy' && request.method === 'PUT') {
      // Accept ?url= (full URL) — preferred
      // Also still accept legacy ?server= (base URL, appends /upload) for compatibility
      const urlParam = url.searchParams.get('url');
      const serverParam = url.searchParams.get('server');

      let uploadUrl: string;

      if (urlParam) {
        try {
          uploadUrl = decodeURIComponent(urlParam);
        } catch {
          return new Response(
            JSON.stringify({ error: 'Invalid ?url= parameter' }),
            { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }
      } else if (serverParam) {
        try {
          uploadUrl = decodeURIComponent(serverParam).replace(/\/+$/, '') + '/upload';
        } catch {
          return new Response(
            JSON.stringify({ error: 'Invalid ?server= parameter' }),
            { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        return new Response(
          JSON.stringify({ error: 'Missing ?url= parameter' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      // Only allow https:// targets
      if (!uploadUrl.startsWith('https://')) {
        return new Response(
          JSON.stringify({ error: 'Upload URL must use https://' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      // Forward relevant headers to the Blossom server
      const forwardHeaders = new Headers();
      const auth = request.headers.get('Authorization');
      const contentType = request.headers.get('Content-Type');
      const contentLength = request.headers.get('Content-Length');
      const xsha256 = request.headers.get('X-SHA-256');

      if (auth) forwardHeaders.set('Authorization', auth);
      if (contentType) forwardHeaders.set('Content-Type', contentType);
      if (contentLength) forwardHeaders.set('Content-Length', contentLength);
      if (xsha256) forwardHeaders.set('X-SHA-256', xsha256);

      let blossomResponse: Response;
      try {
        blossomResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: forwardHeaders,
          body: request.body,
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: `Upstream connection failed: ${(err as Error).message}` }),
          { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      // Forward the Blossom server's response back with CORS headers injected
      const responseBody = await blossomResponse.arrayBuffer();
      const responseHeaders = new Headers(CORS_HEADERS);
      const upstreamContentType = blossomResponse.headers.get('Content-Type');
      responseHeaders.set('Content-Type', upstreamContentType ?? 'application/json');

      return new Response(responseBody, {
        status: blossomResponse.status,
        headers: responseHeaders,
      });
    }

    // ── Static SPA fallback ───────────────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
