/**
 * useUploadFile — uploads files to Blossom servers.
 *
 * Implements BUD-02 upload with BUD-11 authorization (kind:24242).
 * Automatically uses the user's BUD-03 kind:10063 server list.
 * Falls back to blossom.primal.net if no list is found.
 *
 * Auth flow per BUD-11:
 *  - Sign a kind:24242 event with:
 *    - t: "upload"
 *    - x: SHA-256 of the file (hex)
 *    - expiration: unix timestamp ~5 minutes from now
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
  // Base64-encode the JSON event for the Authorization header
  return btoa(unescape(encodeURIComponent(JSON.stringify(event))));
}

async function uploadToBlossom(
  serverUrl: string,
  file: File,
  fileBuffer: ArrayBuffer,
  fileHash: string,
  authToken: string
): Promise<string> {
  const uploadUrl = serverUrl.replace(/\/+$/, '') + '/upload';

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
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`Blossom upload failed: ${errorText}`);
  }

  const json = await response.json().catch(() => null);
  const url: string | undefined = json?.url;
  if (!url) {
    throw new Error('Blossom server did not return a URL');
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

      // Use the user's BUD-03 servers, or fall back to popular Blossom servers
      const servers = blossomServers && blossomServers.length > 0
        ? blossomServers.map(s => s.replace(/\/+$/, ''))
        : [
            'https://blossom.primal.net',
            'https://cdn.satellite.earth',
            'https://blossom.nostr.build',
          ];

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
          const url = await uploadToBlossom(server, file, fileBuffer, fileHash, authToken);
          // Return NIP-94 compatible tags
          const tags: string[][] = [
            ['url', url],
            ['x', fileHash],
            ['m', file.type || 'application/octet-stream'],
            ['size', String(file.size)],
          ];
          return tags;
        } catch (err) {
          lastError = err as Error;
          console.warn(`Blossom upload failed on ${server}:`, (err as Error).message);
        }
      }

      throw lastError ?? new Error('All Blossom servers failed');
    },
  });
}
