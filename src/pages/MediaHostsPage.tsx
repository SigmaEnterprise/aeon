/**
 * Media Hosts Page — BUD-01/02/03 + NIP-96/98
 *
 * Full Blossom protocol compliance:
 *  - BUD-03: kind:10063 server list auto-sync
 *  - BUD-02: PUT /upload with BUD-11 kind:24242 auth
 *  - BUD-01: server probe via HEAD /upload (not NIP-96 JSON)
 *  - BUD-11: Base64url (no padding) auth token encoding per spec
 */
import { useState, useEffect } from 'react';
import { useSeoMeta } from '@unhead/react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { useBlossomServers, usePublishBlossomServers } from '@/hooks/useBlossomServers';
import {
  HardDrive, Plus, Trash2, RefreshCw, Upload, CheckCircle, XCircle,
  Loader2, ExternalLink, Copy, Info, AlertCircle, CloudUpload, Save, Flower,
  ArrowUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── BUD-11: Base64url (no padding) encoding ──────────────────────────────
// Per BUD-11 spec: "MUST be encoded as Base64 URL-safe without padding (Base64url)"
// Standard btoa() produces base64 with +, /, = which is WRONG for BUD-11.

function base64urlEncode(str: string): string {
  // Encode to standard base64 first
  const b64 = btoa(unescape(encodeURIComponent(str)));
  // Convert to base64url: replace + → -, / → _, strip = padding
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Server probe types ───────────────────────────────────────────────────

interface ProbeData {
  api_url?: string;
  apiUrl?: string;
  upload_url?: string;
  download_url?: string;
  max_byte_size?: number;
  max_size?: number;
  maxSize?: number;
  plans?: { free?: { max_byte_size?: number } };
  name?: string;
  description?: string;
  pubkey?: string;
  [key: string]: unknown;
}

interface MediaHostProbe {
  status: 'unknown' | 'probing' | 'ok' | 'error';
  message?: string;
  data?: ProbeData;
  probeUrl?: string;
  protocol?: 'blossom' | 'nip96';
}

// ─── SHA-256 helper ───────────────────────────────────────────────────────

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Normalize Blossom URL ────────────────────────────────────────────────

function normalizeBlossomUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (url.startsWith('wss://')) url = 'https://' + url.slice(6);
  else if (url.startsWith('ws://')) url = 'http://' + url.slice(5);
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  return url;
}

// ─── Main page ────────────────────────────────────────────────────────────

export function MediaHostsPage() {
  useSeoMeta({ title: 'Media Hosts — Aeon', description: 'Manage media upload hosts' });

  const { user } = useCurrentUser();
  const { toast } = useToast();

  const { data: bud03Servers = [], isLoading: bud03Loading } = useBlossomServers();
  const { mutateAsync: publishServers, isPending: isPublishing } = usePublishBlossomServers();

  const [servers, setServers] = useState<string[]>([]);
  const [probes, setProbes] = useState<Record<string, MediaHostProbe>>({});
  const [newUrl, setNewUrl] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  // Sync when BUD-03 loads
  useEffect(() => {
    if (bud03Servers.length > 0 && servers.length === 0) {
      setServers(bud03Servers);
      bud03Servers.forEach(s => probeHost(s));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bud03Servers]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadHost, setUploadHost] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ url: string; host: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  /**
   * Probe a Blossom server using the correct BUD-01 detection strategy:
   *
   * Priority order:
   *  1. HEAD /upload — BUD-02 endpoint detection (Blossom native)
   *  2. GET / with Accept: application/json — some servers return server info
   *  3. GET /.well-known/nostr/nip96.json — NIP-96 servers
   *  4. GET /nip96.json — alternative path
   *
   * A Blossom server is considered "online" if ANY of these return a non-5xx
   * response (including 401 auth-required, 405 method not allowed, etc.)
   * because those still prove the server is alive and responding.
   */
  const probeHost = async (rawUrl: string) => {
    const url = normalizeBlossomUrl(rawUrl);
    setProbes(prev => ({ ...prev, [rawUrl]: { status: 'probing', message: 'Probing server…' } }));

    // ── Step 1: BUD-01/02 native detection ──
    // HEAD /upload tells us if it's a Blossom server. Any response (even 401)
    // means the server is live. 404 means /upload doesn't exist (not Blossom).
    try {
      const headResp = await fetch(url + '/upload', {
        method: 'HEAD',
        signal: AbortSignal.timeout(8000),
      });
      // 200, 401, 402, 405 all mean the server is alive and BUD-02 capable
      if (headResp.status !== 404 && headResp.status < 500) {
        const authRequired = headResp.status === 401 || headResp.status === 402;
        setProbes(prev => ({
          ...prev,
          [rawUrl]: {
            status: 'ok',
            message: authRequired ? 'Blossom server (auth required)' : 'Blossom server online',
            probeUrl: url + '/upload',
            protocol: 'blossom',
            data: { name: url.replace(/^https?:\/\//, '') },
          }
        }));
        return;
      }
    } catch { /* server may not support HEAD, try next */ }

    // ── Step 2: GET / with application/json ──
    // BUD-01 servers may return server info at root
    try {
      const rootResp = await fetch(url + '/', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (rootResp.ok) {
        let data: ProbeData | null = null;
        try {
          const text = await rootResp.text();
          data = JSON.parse(text) as ProbeData;
        } catch { /* not JSON, but server is alive */ }

        if (data || rootResp.ok) {
          setProbes(prev => ({
            ...prev,
            [rawUrl]: {
              status: 'ok',
              message: data?.name ? `${data.name}` : 'Server online',
              probeUrl: url + '/',
              protocol: 'blossom',
              data: data ?? undefined,
            }
          }));
          return;
        }
      }
    } catch { /* try next */ }

    // ── Step 3: NIP-96 JSON detection ──
    const nip96Candidates = [
      url + '/.well-known/nostr/nip96.json',
      url + '/nip96.json',
      url + '/api/v1/nip96.json',
    ];

    for (const candidate of nip96Candidates) {
      try {
        const resp = await fetch(candidate, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) continue;
        const text = await resp.text();
        let data: ProbeData | null = null;
        try { data = JSON.parse(text) as ProbeData; } catch { continue; }
        if (data) {
          const flat: ProbeData = { ...data };
          if (flat.data && typeof flat.data === 'object') Object.assign(flat, flat.data);
          setProbes(prev => ({
            ...prev,
            [rawUrl]: {
              status: 'ok',
              message: `NIP-96 server (${new URL(candidate).pathname})`,
              data: flat,
              probeUrl: candidate,
              protocol: 'nip96',
            }
          }));
          return;
        }
      } catch { /* try next */ }
    }

    // ── Step 4: Last resort — plain GET / ──
    try {
      const resp = await fetch(url + '/', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status < 500) {
        // Server responded (even with 4xx), so it's alive
        setProbes(prev => ({
          ...prev,
          [rawUrl]: {
            status: 'ok',
            message: resp.status === 401 || resp.status === 402
              ? 'Server online (authentication required)'
              : `Server online (HTTP ${resp.status})`,
            probeUrl: url + '/',
            protocol: 'blossom',
          }
        }));
        return;
      }
    } catch { /* truly unreachable */ }

    setProbes(prev => ({
      ...prev,
      [rawUrl]: {
        status: 'error',
        message: 'Server unreachable — check URL or CORS policy',
      }
    }));
  };

  const probeAll = () => servers.forEach(s => probeHost(s));

  const addServer = () => {
    let trimmed = newUrl.trim().replace(/\/+$/, '');
    // Auto-fix protocol: wss:// → https://
    if (trimmed.startsWith('wss://')) trimmed = 'https://' + trimmed.slice(6);
    else if (trimmed.startsWith('ws://')) trimmed = 'http://' + trimmed.slice(5);
    if (!trimmed || (!trimmed.startsWith('https://') && !trimmed.startsWith('http://'))) {
      toast({
        title: 'Invalid URL',
        description: 'Blossom servers use HTTPS (not wss://). Example: https://blossom.example.com',
        variant: 'destructive'
      });
      return;
    }
    if (servers.includes(trimmed)) {
      toast({ title: 'Already in list', variant: 'destructive' });
      return;
    }
    setServers(prev => [...prev, trimmed]);
    setNewUrl('');
    setIsDirty(true);
    probeHost(trimmed);
  };

  const removeServer = (url: string) => {
    setServers(prev => prev.filter(s => s !== url));
    setIsDirty(true);
  };

  const moveUp = (i: number) => {
    if (i === 0) return;
    setServers(prev => { const a = [...prev]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; });
    setIsDirty(true);
  };

  const handlePublish = async () => {
    if (!user) { toast({ title: 'Login required', variant: 'destructive' }); return; }
    try {
      await publishServers(servers);
      setIsDirty(false);
      toast({ title: 'Server list published (kind:10063)!' });
    } catch (err) {
      toast({ title: 'Publish failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  /**
   * BUD-11: Build kind:24242 Blossom authorization token.
   *
   * CRITICAL: Must use Base64url (no padding) encoding per the BUD-11 spec.
   * Standard btoa() produces base64 with +, /, = which FAILS on strict servers.
   * Use base64urlEncode() which converts + → -, / → _, strips = padding.
   */
  const buildBlossomAuth = async (
    fileHash: string,
    fileSize: number,
    contentType: string
  ): Promise<string> => {
    if (!user) throw new Error('Not logged in');
    const now = Math.floor(Date.now() / 1000);
    const event = await user.signer.signEvent({
      kind: 24242,
      content: 'Upload file',
      tags: [
        ['t', 'upload'],
        ['x', fileHash],
        ['expiration', String(now + 300)],
        // Optional: scope token to this specific file hash (BUD-11 x-tag scoping)
      ],
      created_at: now,
    });
    // ✅ CORRECT: Base64url without padding (BUD-11 spec compliant)
    return base64urlEncode(JSON.stringify(event));
  };

  const handleTestUpload = async () => {
    if (!selectedFile || !uploadHost || !user) return;
    setIsUploading(true);
    setUploadProgress(0);
    setUploadResult(null);

    try {
      const normalizedHost = normalizeBlossomUrl(uploadHost);
      const fileBuffer = await selectedFile.arrayBuffer();
      setUploadProgress(20);

      const fileHash = await sha256Hex(fileBuffer);
      setUploadProgress(40);

      const authB64url = await buildBlossomAuth(
        fileHash,
        selectedFile.size,
        selectedFile.type || 'application/octet-stream'
      );
      setUploadProgress(60);

      // BUD-02: PUT /upload per spec
      const uploadUrl = normalizedHost + '/upload';
      const resp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'Nostr ' + authB64url,
          'Content-Type': selectedFile.type || 'application/octet-stream',
          'Content-Length': String(selectedFile.size),
          'X-SHA-256': fileHash,
        },
        body: fileBuffer,
        signal: AbortSignal.timeout(120000),
      });

      setUploadProgress(85);

      if (!resp.ok) {
        // Check X-Reason header per BUD-01 spec
        const reason = resp.headers.get('X-Reason');
        const errText = reason ?? await resp.text().catch(() => `HTTP ${resp.status}`);
        throw new Error(`Upload failed (HTTP ${resp.status}): ${errText}`);
      }

      const json = await resp.json().catch(() => null) as { url?: string; sha256?: string } | null;
      const uploadedUrl: string | undefined = json?.url;
      if (!uploadedUrl) throw new Error('Server did not return a URL in the response body');

      setUploadProgress(100);
      setUploadResult({ url: uploadedUrl, host: uploadHost });
      toast({ title: '✅ Upload successful!' });
    } catch (err) {
      toast({ title: 'Upload failed', description: (err as Error).message, variant: 'destructive' });
    }
    setIsUploading(false);
  };

  const getMaxBytes = (probe: MediaHostProbe): number | null => {
    if (!probe.data) return null;
    return probe.data.plans?.free?.max_byte_size ?? probe.data.max_byte_size ?? probe.data.max_size ?? null;
  };

  const formatBytes = (bytes: number) =>
    bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB`
    : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${(bytes / 1073741824).toFixed(1)} GB`;

  const statusIcon = (probe: MediaHostProbe) => {
    if (probe.status === 'probing') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (probe.status === 'ok') return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (probe.status === 'error') return <XCircle className="h-4 w-4 text-destructive" />;
    return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <Card className="shadow-sm border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flower className="h-5 w-5 text-pink-500" />
              Blossom Media Servers
              <Badge variant="secondary" className="text-xs ml-1">BUD-01/02/03</Badge>
            </CardTitle>
            <CardDescription>
              Your preferred Blossom upload servers are stored as a{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">kind:10063</code> event (BUD-03).
              All servers use <strong>HTTPS</strong> REST — not WebSocket.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {bud03Loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your kind:10063 server list…
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-green-500" />
                {bud03Servers.length} server{bud03Servers.length !== 1 ? 's' : ''} found in kind:10063
              </div>
            )}

            {/* Protocol note */}
            <Alert className="border-blue-500/30 bg-blue-500/5 py-2">
              <Info className="h-3.5 w-3.5 text-blue-500" />
              <AlertDescription className="text-xs text-blue-700 dark:text-blue-300">
                Blossom servers use <strong>https://</strong> — never wss://. If you see "wss://" in your server URL,
                it will be automatically corrected to "https://".
              </AlertDescription>
            </Alert>

            {/* Add server input */}
            <div className="flex gap-2">
              <Input
                placeholder="https://blossom.example.com"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addServer()}
                className="flex-1 font-mono text-sm"
              />
              <Button onClick={addServer} className="gap-1.5 shrink-0" disabled={!newUrl.trim()}>
                <Plus className="h-4 w-4" />Add
              </Button>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={probeAll} className="gap-1.5" size="sm">
                <RefreshCw className="h-3.5 w-3.5" />Probe All
              </Button>
              {user && isDirty && (
                <Button onClick={handlePublish} className="gap-1.5" size="sm" disabled={isPublishing}>
                  {isPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Publish kind:10063
                </Button>
              )}
              {isDirty && (
                <Badge variant="outline" className="text-xs self-center">Unsaved changes</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Server list */}
        <div className="space-y-3">
          {servers.map((url, i) => {
            const probe = probes[url] ?? { status: 'unknown' as const };
            const maxBytes = getMaxBytes(probe);
            const displayUrl = normalizeBlossomUrl(url);

            return (
              <Card key={url} className={cn(
                'transition-all duration-200',
                probe.status === 'ok' && 'border-green-500/30',
                probe.status === 'error' && 'border-destructive/30',
                i === 0 && 'ring-1 ring-primary/30'
              )}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">{statusIcon(probe)}</div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm font-mono truncate">
                          {displayUrl.replace(/^https?:\/\//, '')}
                        </span>
                        {i === 0 && <Badge className="text-[10px] px-1.5 py-0 shrink-0">Primary</Badge>}
                        {probe.protocol === 'blossom' && probe.status === 'ok' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 border-pink-500/40 text-pink-600 dark:text-pink-400">
                            Blossom
                          </Badge>
                        )}
                        {probe.protocol === 'nip96' && probe.status === 'ok' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 border-blue-500/40 text-blue-600 dark:text-blue-400">
                            NIP-96
                          </Badge>
                        )}
                        {probe.status === 'ok' && (
                          <Badge className="text-[10px] px-1.5 py-0 bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30">
                            Online
                          </Badge>
                        )}
                        {probe.status === 'error' && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Offline</Badge>
                        )}
                      </div>

                      {probe.status === 'ok' && (
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <p>{probe.message}</p>
                          {probe.data?.name && typeof probe.data.name === 'string' && probe.data.name !== displayUrl.replace(/^https?:\/\//, '') && (
                            <p className="font-medium text-foreground">{probe.data.name}</p>
                          )}
                          {maxBytes && (
                            <p>Max upload size: <strong>{formatBytes(maxBytes)}</strong></p>
                          )}
                        </div>
                      )}

                      {probe.status === 'error' && (
                        <div className="text-xs space-y-1">
                          <p className="text-destructive">{probe.message}</p>
                          <p className="text-muted-foreground">
                            Tip: Check the URL starts with <code>https://</code> and the server is running.
                          </p>
                        </div>
                      )}

                      {probe.status === 'probing' && (
                        <p className="text-xs text-muted-foreground">{probe.message}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {i > 0 && (
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0"
                          onClick={() => moveUp(i)} title="Move to primary"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm" className="h-7 w-7 p-0"
                        onClick={() => probeHost(url)} title="Re-probe"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                        <a href={displayUrl} target="_blank" rel="noopener noreferrer" title="Open server">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => removeServer(url)}
                        title="Remove server"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {servers.length === 0 && !bud03Loading && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <HardDrive className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground text-sm">No media hosts configured. Add one above.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Popular Blossom servers: blossom.primal.net, cdn.satellite.earth
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <Separator />

        {/* Test Upload */}
        {user ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CloudUpload className="h-4 w-4 text-primary" />
                Test Upload (BUD-02 + BUD-11)
              </CardTitle>
              <CardDescription className="text-xs">
                Upload a file using BUD-11 kind:24242 auth (Base64url encoded) to verify your server works.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">File</Label>
                  <Input
                    type="file"
                    accept="image/*,video/*,audio/*"
                    className="text-xs"
                    onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
                  />
                  {selectedFile && (
                    <p className="text-xs text-muted-foreground">
                      {selectedFile.name} — {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Host</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={uploadHost}
                    onChange={e => setUploadHost(e.target.value)}
                  >
                    <option value="">Select a server…</option>
                    {/* Show all servers — not just probed ones, since probe may use CORS-restricted paths */}
                    {servers.map(s => {
                      const norm = normalizeBlossomUrl(s);
                      const p = probes[s];
                      const label = norm.replace(/^https?:\/\//, '');
                      const statusLabel = p?.status === 'ok' ? '✓' : p?.status === 'error' ? '✗' : '?';
                      return (
                        <option key={s} value={norm}>{statusLabel} {label}</option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {isUploading && <Progress value={uploadProgress} className="h-2" />}

              {uploadResult && (
                <div className="space-y-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">
                      Upload successful!
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={uploadResult.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-primary hover:underline flex-1 truncate"
                    >
                      {uploadResult.url}
                    </a>
                    <Button variant="ghost" size="sm" className="h-6 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(uploadResult.url); toast({ title: 'URL copied!' }); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  {/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(uploadResult.url) && (
                    <img
                      src={uploadResult.url}
                      alt="Uploaded"
                      className="max-w-full max-h-48 rounded-lg object-contain"
                    />
                  )}
                </div>
              )}

              <Button
                onClick={handleTestUpload}
                disabled={!selectedFile || !uploadHost || isUploading}
                className="gap-2"
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isUploading ? 'Uploading…' : 'Test Upload (BUD-02)'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">Log in to test BUD-02 authenticated uploads.</AlertDescription>
          </Alert>
        )}
      </div>
    </AppLayout>
  );
}
