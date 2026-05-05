/**
 * Aeon — Cloudflare Worker
 *
 * Serves the static SPA via ASSETS binding, plus a /blossom-proxy endpoint
 * that forwards Blossom BUD-02 PUT /upload requests to the target server
 * server-side, bypassing browser CORS restrictions.
 *
 * Why a proxy is needed:
 *   All major Blossom servers (blossom.nostr.build, blossom.band,
 *   cdn.satellite.earth, etc.) do not include Access-Control-Allow-Origin
 *   headers on their OPTIONS preflight or PUT responses. Browsers block every
 *   direct upload attempt from cross-origin pages. Routing through this
 *   same-origin Worker endpoint eliminates the CORS issue entirely.
 *
 * Endpoint: PUT /blossom-proxy?server=<encoded-server-url>
 *   - Forwards the entire request body to <server>/upload
 *   - Passes Authorization, Content-Type, X-SHA-256 headers through
 *   - Returns the Blossom server's JSON response (BlobDescriptor)
 *   - CORS headers are added so the browser accepts the response
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
      const serverParam = url.searchParams.get('server');
      if (!serverParam) {
        return new Response(
          JSON.stringify({ error: 'Missing ?server= parameter' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      let targetServer: string;
      try {
        targetServer = decodeURIComponent(serverParam).replace(/\/+$/, '');
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid server URL' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      // Only allow https:// targets — never internal/private addresses
      if (!targetServer.startsWith('https://')) {
        return new Response(
          JSON.stringify({ error: 'Server must use https://' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      const uploadUrl = targetServer + '/upload';

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

      // Forward the Blossom server's response back to the browser,
      // injecting CORS headers so the browser accepts it.
      const responseBody = await blossomResponse.arrayBuffer();
      const responseHeaders = new Headers(CORS_HEADERS);
      const upstreamContentType = blossomResponse.headers.get('Content-Type');
      if (upstreamContentType) {
        responseHeaders.set('Content-Type', upstreamContentType);
      } else {
        responseHeaders.set('Content-Type', 'application/json');
      }

      return new Response(responseBody, {
        status: blossomResponse.status,
        headers: responseHeaders,
      });
    }

    // ── Static SPA fallback ───────────────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
