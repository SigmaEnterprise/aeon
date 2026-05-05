/**
 * useUploadFile — Blossom BUD-02 file upload via same-origin Worker proxy.
 *
 * WHY A PROXY IS REQUIRED:
 *   Every major Blossom server (blossom.nostr.build, blossom.band,
 *   cdn.satellite.earth, blossom.primal.net, etc.) does NOT send
 *   Access-Control-Allow-Origin headers on OPTIONS preflight responses.
 *   Browsers unconditionally block cross-origin PUT requests to these servers.
 *   The only working solution from a browser-hosted app is to proxy uploads
 *   through a same-origin server that adds CORS headers.
 *
 * HOW IT WORKS:
 *   All uploads go to PUT /blossom-proxy?server=<encoded-server-url> on the
 *   same origin (aeon.ceronode.workers.dev). The Cloudflare Worker in worker.ts
 *   forwards the request server-side to the Blossom server and returns the
 *   response with proper CORS headers attached.
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
 */
function base64urlEncode(str: string): string {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Normalize a Blossom server URL:
 *  - Strip trailing slashes
 *  - Convert wss:// → https://, ws:// → http://
 *  - Add https:// if no protocol present
 */
function normalizeBlossomUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (url.startsWith('wss://')) url = 'https://' + url.slice(6);
  else if (url.startsWith('ws://')) url = 'http://' + url.slice(5);
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  return url;
}

/**
 * Build BUD-11 authorization token (kind:24242).
 */
async function buildBlossomAuth(
  signer: { signEvent: (e: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
  }) => Promise<{ id: string; pubkey: string; sig: string; kind: number; content: string; tags: string[][]; created_at: number }> },
  fileHash: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const event = await signer.signEvent({
    kind: 24242,
    content: 'Upload file',
    tags: [
      ['t', 'upload'],
      ['x', fileHash],
      ['expiration', String(now + 300)],
    ],
    created_at: now,
  });
  return base64urlEncode(JSON.stringify(event));
}

/**
 * Upload a file to one Blossom server via the /blossom-proxy Worker endpoint.
 *
 * The proxy is on the same origin as the app, so no CORS preflight is needed.
 * The Worker forwards the PUT to <server>/upload server-side and returns
 * the Blossom BlobDescriptor JSON with CORS headers added.
 */
async function uploadToBlossomViaProxy(
  serverUrl: string,
  file: File,
  fileBuffer: ArrayBuffer,
  fileHash: string,
  authToken: string
): Promise<string> {
  const normalized = normalizeBlossomUrl(serverUrl);
  const proxyUrl = `/blossom-proxy?server=${encodeURIComponent(normalized)}`;

  const response = await fetch(proxyUrl, {
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

    if (response.status === 413) throw new Error(`File too large (HTTP 413). Try a smaller file or different server.`);
    if (response.status === 401 || response.status === 403) throw new Error(`Authentication failed (HTTP ${response.status}): ${errorText}`);
    if (response.status === 404) throw new Error(`Upload endpoint not found on ${normalized}. This server may not support BUD-02.`);
    throw new Error(`Upload failed (HTTP ${response.status}): ${errorText}`);
  }

  const json = await response.json().catch(() => null) as { url?: string; sha256?: string } | null;
  const url: string | undefined = json?.url;
  if (!url) throw new Error('Blossom server did not return a file URL');
  return url;
}

export function useUploadFile() {
  const { user } = useCurrentUser();
  const { data: blossomServers } = useBlossomServers();

  return useMutation({
    mutationFn: async (file: File): Promise<string[][]> => {
      if (!user) throw new Error('Must be logged in to upload files');

      const rawServers = blossomServers && blossomServers.length > 0
        ? blossomServers
        : [
            'https://blossom.nostr.build',
            'https://blossom.band',
            'https://cdn.satellite.earth',
          ];

      const servers = rawServers.map(normalizeBlossomUrl);

      const fileBuffer = await file.arrayBuffer();
      const fileHash = await sha256Hex(fileBuffer);
      const authToken = await buildBlossomAuth(user.signer, fileHash);

      let lastError: Error | null = null;
      for (const server of servers) {
        try {
          const uploadedUrl = await uploadToBlossomViaProxy(server, file, fileBuffer, fileHash, authToken);

          const tags: string[][] = [
            ['url', uploadedUrl],
            ['x', fileHash],
            ['m', file.type || 'application/octet-stream'],
            ['size', String(file.size)],
          ];

          if (file.type.startsWith('image/')) {
            tags.push(['thumb', `https://wsrv.nl/?url=${encodeURIComponent(uploadedUrl)}&w=800&output=webp&q=80`]);
          }

          return tags;
        } catch (err) {
          lastError = err as Error;
          console.warn(`[Blossom] Upload failed on ${server}:`, (err as Error).message);
        }
      }

      throw lastError ?? new Error('All Blossom servers failed. Go to Media Hosts to configure your upload servers.');
    },
  });
}
