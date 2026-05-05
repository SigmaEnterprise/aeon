/**
 * useUploadFile — Blossom BUD-02 file upload via same-origin Worker proxy.
 *
 * WHY A PROXY IS REQUIRED:
 *   Every major Blossom server does NOT send Access-Control-Allow-Origin
 *   headers on OPTIONS preflight responses. Browsers block all cross-origin
 *   PUT requests. All uploads go through PUT /blossom-proxy on the same
 *   origin; the Worker forwards server-side with CORS headers injected.
 *
 * UPLOAD PATH AUTO-DISCOVERY:
 *   BUD-02 standard path:  <server>/upload
 *   Pyramid server path:   <server>/blossom/upload
 *
 *   We try the standard path first. On 404, we try /blossom/upload.
 *   This handles self-hosted Pyramid servers (like aeon.libretechsystems.xyz)
 *   without the user needing to know or enter the sub-path.
 *
 * References:
 *  - https://github.com/hzrd149/blossom/blob/master/buds/02.md (BUD-02)
 *  - https://github.com/hzrd149/blossom/blob/master/buds/11.md (BUD-11)
 *  - https://github.com/fiatjaf/pyramid (Pyramid blossom at /blossom/upload)
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

/** BUD-11: Base64url without padding (not standard base64) */
function base64urlEncode(str: string): string {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strip trailing slashes, fix wss:// → https://, add https:// if missing */
function normalizeBlossomUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (url.startsWith('wss://')) url = 'https://' + url.slice(6);
  else if (url.startsWith('ws://')) url = 'http://' + url.slice(5);
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  return url;
}

/** Build BUD-11 kind:24242 authorization token */
async function buildBlossomAuth(
  signer: { signEvent: (e: {
    kind: number; content: string; tags: string[][]; created_at: number;
  }) => Promise<{ id: string; pubkey: string; sig: string; kind: number; content: string; tags: string[][]; created_at: number }> },
  fileHash: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const event = await signer.signEvent({
    kind: 24242,
    content: 'Upload file',
    tags: [['t', 'upload'], ['x', fileHash], ['expiration', String(now + 300)]],
    created_at: now,
  });
  return base64urlEncode(JSON.stringify(event));
}

/**
 * Try one PUT /blossom-proxy?url=<uploadUrl> request.
 * Returns the blob URL on success, throws a typed error on failure.
 */
async function doProxyUpload(
  uploadUrl: string,
  file: File,
  fileBuffer: ArrayBuffer,
  fileHash: string,
  authToken: string,
): Promise<string> {
  const proxyUrl = `/blossom-proxy?url=${encodeURIComponent(uploadUrl)}`;

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
        // body is plain text
        if (body.trim() && !body.trim().startsWith('<')) {
          errorText = body.slice(0, 200);
        }
      }
    } catch { /* ignore */ }

    const err = new Error(`HTTP ${response.status}: ${errorText}`) as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  const json = await response.json().catch(() => null) as { url?: string; sha256?: string } | null;
  const blobUrl = json?.url;
  if (!blobUrl) throw new Error('Blossom server did not return a file URL');
  return blobUrl;
}

/**
 * Upload to one Blossom server, auto-discovering the correct upload path.
 *
 * Tries in order:
 *   1. <server>/upload          — BUD-02 standard (most servers)
 *   2. <server>/blossom/upload  — Pyramid community relay servers
 *
 * Returns the public blob URL on success.
 */
async function uploadToServer(
  serverBase: string,
  file: File,
  fileBuffer: ArrayBuffer,
  fileHash: string,
  authToken: string,
): Promise<string> {
  const normalized = normalizeBlossomUrl(serverBase);

  // Standard BUD-02 path
  const standardUrl = normalized + '/upload';
  try {
    return await doProxyUpload(standardUrl, file, fileBuffer, fileHash, authToken);
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    // Only fall through to alternative path on 404
    if (status !== 404) throw err;
    console.info(`[Blossom] ${normalized}/upload returned 404, trying /blossom/upload (Pyramid server)…`);
  }

  // Pyramid alternative path: /blossom/upload
  const pyramidUrl = normalized + '/blossom/upload';
  return await doProxyUpload(pyramidUrl, file, fileBuffer, fileHash, authToken);
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
          const uploadedUrl = await uploadToServer(server, file, fileBuffer, fileHash, authToken);

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
