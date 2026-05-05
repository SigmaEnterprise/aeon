/**
 * useUploadFile — Blossom BUD-02 file upload.
 *
 * How it works:
 *  1. HTTPS only — any wss:// URL is rewritten to https:// automatically.
 *  2. No pre-probe — HEAD /upload is unreliable (some servers return 404 on
 *     HEAD but work fine on PUT). We go straight to PUT /upload with auth.
 *  3. BUD-11 auth (kind:24242) — signed event with SHA-256 hash + expiration.
 *  4. CORS fallback — if direct PUT gets a TypeError/network error (CORS block),
 *     automatically retries via the shakespeare.diy CORS proxy.
 *  5. Multi-server — tries each server in the user's BUD-03 list in order,
 *     falls back to hardcoded CORS-friendly defaults if no list is found.
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
 * BUD-11 spec: Authorization header MUST use Base64url without padding.
 * Standard btoa() produces base64 with +, /, = which strict servers reject.
 * This converts to the correct format: + → -, / → _, strip trailing =
 */
function base64urlEncode(str: string): string {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    ],
    created_at: now,
  });
  // ✅ BUD-11 spec: Base64url WITHOUT padding (not standard base64)
  return base64urlEncode(JSON.stringify(event));
}

// NOTE: The checkBlossomServer() pre-probe (HEAD /upload) has been intentionally
// removed. Several compliant Blossom servers (e.g. cdn.satellite.earth) return 404
// on HEAD /upload but work correctly on PUT /upload with auth. Pre-probing caused
// valid servers to be skipped. The PUT itself is the authoritative test.

/** CORS proxy base URL — used as fallback when direct upload is blocked */
const CORS_PROXY = 'https://proxy.shakespeare.diy/?url=';

/**
 * Build the upload URL, optionally routing through the CORS proxy.
 * The proxy is needed for servers that don't set Access-Control-Allow-Origin: *
 * (e.g. blossom.primal.net, nostr.build).
 */
function buildUploadUrl(normalizedServerUrl: string, useProxy: boolean): string {
  const directUrl = normalizedServerUrl + '/upload';
  if (!useProxy) return directUrl;
  return CORS_PROXY + encodeURIComponent(directUrl);
}

/**
 * Attempt a single PUT /upload request.
 * Returns the blob URL on success, throws on failure.
 */
async function doUploadRequest(
  uploadUrl: string,
  file: File,
  fileBuffer: ArrayBuffer,
  fileHash: string,
  authToken: string
): Promise<string> {
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
      try {
        const json = JSON.parse(body) as { message?: string; error?: string };
        errorText = json.message ?? json.error ?? errorText;
      } catch {
        errorText = body.slice(0, 200) || errorText;
      }
    } catch { /* ignore */ }

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

/**
 * Upload a file to a single Blossom server.
 * First tries a direct PUT /upload. If that fails due to CORS (TypeError / network error),
 * automatically retries through the shakespeare.diy CORS proxy.
 */
async function uploadToBlossom(
  serverUrl: string,
  file: File,
  fileBuffer: ArrayBuffer,
  fileHash: string,
  authToken: string
): Promise<string> {
  const normalizedUrl = normalizeBlossomUrl(serverUrl);

  // ── Attempt 1: Direct upload (works for CORS-compliant servers) ──
  try {
    return await doUploadRequest(
      buildUploadUrl(normalizedUrl, false),
      file, fileBuffer, fileHash, authToken
    );
  } catch (err) {
    const msg = (err as Error).message ?? '';
    // TypeError usually means a network/CORS failure (browser won't reveal specifics).
    // Other errors (auth, too large, 404) are real failures — don't retry via proxy.
    const isCorsLikeError = err instanceof TypeError || msg.includes('Failed to fetch') || msg.includes('NetworkError');
    if (!isCorsLikeError) throw err;
    console.warn(`[Blossom] Direct upload blocked (likely CORS) for ${normalizedUrl}, retrying via CORS proxy…`);
  }

  // ── Attempt 2: Via CORS proxy (for servers blocking cross-origin requests) ──
  return await doUploadRequest(
    buildUploadUrl(normalizedUrl, true),
    file, fileBuffer, fileHash, authToken
  );
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
      // Default servers chosen for reliable CORS support in browser environments.
      // blossom.primal.net, nostr.build, and void.cat are intentionally excluded
      // because they block cross-origin requests from browser clients (CORS failure).
      const rawServers = blossomServers && blossomServers.length > 0
        ? blossomServers
        : [
            'https://cdn.satellite.earth',
            'https://cdn.nostrcheck.me',
            'https://blossom.nostr.hu',
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

      // Try each server in order, return on first success.
      // No pre-probe — go straight to PUT /upload with auth.
      // The actual HTTP response from PUT is the only reliable indicator.
      let lastError: Error | null = null;
      for (const server of servers) {
        try {
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

      throw lastError ?? new Error('All Blossom servers failed. Go to Media Hosts to add or change your upload servers.');
    },
  });
}
