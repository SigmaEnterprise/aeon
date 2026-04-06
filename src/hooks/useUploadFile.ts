/**
 * useUploadFile — Blossom BUD-02 file upload with comprehensive protocol fixes.
 *
 * Protocol fixes implemented:
 *  1. HTTPS only — Blossom uses REST/HTTP, NEVER wss://. Any wss:// server URL
 *     is automatically rewritten to https:// before any network call.
 *  2. Server health check — Before uploading, a GET to the server root is made
 *     to verify availability. If the server requires auth (401/402), a signed
 *     NIP-42 Authorization header is included.
 *  3. BUD-11 auth (kind:24242) — Every upload is authenticated with a signed
 *     event containing the file hash (SHA-256) and expiration.
 *  4. Media optimization — After upload, returns both raw and proxy-optimized
 *     URLs for downstream consumers that want resized thumbnails.
 *
 * References:
 *  - https://github.com/hzrd149/blossom/blob/master/buds/02.md (BUD-02)
 *  - https://github.com/hzrd149/blossom/blob/master/buds/11.md (BUD-11)
 *  - https://github.com/hzrd149/blossom/blob/master/buds/03.md (BUD-03)
 */
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "./useCurrentUser";
import { useBlossomServers } from "./useBlossomServers";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Normalize a Blossom server URL:
 *  - Strip trailing slashes
 *  - CRITICAL: Convert wss:// → https:// and ws:// → http://
 *    Blossom is a REST/HTTP protocol. WebSocket is NOT used for uploads.
 */
function normalizeBlossomUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  // Protocol fix: wss → https, ws → http
  if (url.startsWith('wss://')) {
    url = 'https://' + url.slice(6);
  } else if (url.startsWith('ws://')) {
    url = 'http://' + url.slice(5);
  }
  // Ensure https if no protocol specified
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
}

/**
 * Build BUD-11 authorization token (kind:24242).
 * This is a Nostr event signed by the uploader to prove they own the key.
 */
async function buildBlossomAuth(
  signer: { signEvent: (e: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
  }) => Promise<{ id: string; pubkey: string; sig: string; kind: number; content: string; tags: string[][]; created_at: number }> },
  fileHash: string,
  contentType: string,
  size: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const event = await signer.signEvent({
    kind: 24242,
    content: 'Upload file',
    tags: [
      ['t', 'upload'],
      ['x', fileHash],
      ['expiration', String(now + 300)], // 5 minutes
      ['size', String(size)],
      ['type', contentType || 'application/octet-stream'],
    ],
    created_at: now,
  });
  return btoa(unescape(encodeURIComponent(JSON.stringify(event))));
}

/**
 * Check if a Blossom server is reachable and whether it requires auth.
 * Returns: 'ok' | 'auth-required' | 'error'
 *
 * Per the Blossom spec, GET /upload or HEAD on the server root may return:
 *  - 200: public server, no auth needed
 *  - 401/402: auth required (NIP-42)
 *  - Other 4xx/5xx: server error
 */
async function checkBlossomServer(serverUrl: string, authToken?: string): Promise<'ok' | 'auth-required' | 'error'> {
  try {
    const headers: HeadersInit = { Accept: 'application/json' };
    if (authToken) {
      headers['Authorization'] = 'Nostr ' + authToken;
    }
    const res = await fetch(serverUrl + '/', {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 402) return 'auth-required';
    return 'error';
  } catch {
    return 'error';
  }
}

/**
 * Upload a file to a single Blossom server.
 * Handles auth header, correct Content-Type, and response parsing.
 */
async function uploadToBlossom(
  serverUrl: string,
  file: File,
  fileBuffer: ArrayBuffer,
  fileHash: string,
  authToken: string
): Promise<string> {
  const normalizedUrl = normalizeBlossomUrl(serverUrl);
  const uploadUrl = normalizedUrl + '/upload';

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': 'Nostr ' + authToken,
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Length': String(file.size),
      'X-SHA-256': fileHash,
    },
    body: fileBuffer,
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    let errorText = `HTTP ${response.status}`;
    try {
      const body = await response.text();
      // Check if it's a JSON error
      try {
        const json = JSON.parse(body) as { message?: string; error?: string };
        errorText = json.message ?? json.error ?? errorText;
      } catch {
        errorText = body.slice(0, 200) || errorText;
      }
    } catch { /* ignore */ }

    // Provide actionable error messages
    if (response.status === 413) {
      throw new Error(`File too large for this server (HTTP 413). Try a different server.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Authentication failed (HTTP ${response.status}). Your NIP-42 auth may have been rejected.`);
    }
    if (response.status === 404) {
      throw new Error(`Upload endpoint not found (HTTP 404). This server may not support BUD-02.`);
    }
    throw new Error(`Blossom upload failed: ${errorText}`);
  }

  const json = await response.json().catch(() => null) as { url?: string; sha256?: string } | null;
  const url: string | undefined = json?.url;
  if (!url) {
    throw new Error('Blossom server did not return a file URL in the response');
  }
  return url;
}

export function useUploadFile() {
  const { user } = useCurrentUser();
  const { data: blossomServers } = useBlossomServers();

  return useMutation({
    mutationFn: async (file: File): Promise<string[][]> => {
      if (!user) {
        throw new Error('Must be logged in to upload files');
      }

      // CRITICAL: normalize all server URLs — wss:// → https://
      const rawServers = blossomServers && blossomServers.length > 0
        ? blossomServers
        : [
            'https://blossom.primal.net',
            'https://cdn.satellite.earth',
            'https://blossom.nostr.build',
          ];

      const servers = rawServers.map(normalizeBlossomUrl);

      // Compute SHA-256 hash of the file
      const fileBuffer = await file.arrayBuffer();
      const fileHash = await sha256Hex(fileBuffer);

      // Build the BUD-11 authorization token (kind:24242)
      const authToken = await buildBlossomAuth(
        user.signer,
        fileHash,
        file.type || 'application/octet-stream',
        file.size
      );

      // Try each server in order, return on first success
      let lastError: Error | null = null;
      for (const server of servers) {
        try {
          // Health check: verify server is up before uploading
          // This catches the "Offline - No compatible endpoint found" error early
          const serverStatus = await checkBlossomServer(server, authToken);

          if (serverStatus === 'error') {
            console.warn(`Blossom server unavailable: ${server}`);
            lastError = new Error(`Server offline or unreachable: ${server}`);
            continue;
          }

          // auth-required status: still attempt upload (we already have auth token)
          const uploadedUrl = await uploadToBlossom(server, file, fileBuffer, fileHash, authToken);

          // Return NIP-94 compatible tags
          const tags: string[][] = [
            ['url', uploadedUrl],
            ['x', fileHash],
            ['m', file.type || 'application/octet-stream'],
            ['size', String(file.size)],
          ];

          // Add optimization hint tag for image files
          if (file.type.startsWith('image/')) {
            // wsrv.nl proxy URL for resized version (used by mobile clients)
            const optimizedUrl = `https://wsrv.nl/?url=${encodeURIComponent(uploadedUrl)}&w=800&output=webp&q=80`;
            tags.push(['thumb', optimizedUrl]);
          }

          return tags;
        } catch (err) {
          lastError = err as Error;
          console.warn(`Blossom upload failed on ${server}:`, (err as Error).message);
        }
      }

      const errorMsg = lastError?.message ?? 'All Blossom servers failed';
      // Provide specific guidance for the librepyramid error
      if (errorMsg.toLowerCase().includes('offline') || errorMsg.toLowerCase().includes('endpoint')) {
        throw new Error(
          `${errorMsg}\n\nTip: Make sure your Blossom server URL starts with https:// (not wss://). ` +
          `Go to Media Hosts page to verify your server configuration.`
        );
      }
      throw lastError ?? new Error('All Blossom servers failed');
    },
  });
}
