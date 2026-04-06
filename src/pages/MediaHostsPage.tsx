/**
 * Media Hosts Page — BUD-03 + NIP-96/98
 *
 * - Auto-pulls user's Blossom servers from kind:10063 (BUD-03)
 * - Lets user edit and publish their server list
 * - Probes each server for NIP-96 capability
 * - Test NIP-98 authenticated upload
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProbeData {
  api_url?: string;
  apiUrl?: string;
  upload_url?: string;
  download_url?: string;
  max_byte_size?: number;
  max_size?: number;
  maxSize?: number;
  plans?: { free?: { max_byte_size?: number } };
  [key: string]: unknown;
}

interface MediaHostProbe {
  status: 'unknown' | 'probing' | 'ok' | 'error';
  message?: string;
  data?: ProbeData;
  probeUrl?: string;
}


export function MediaHostsPage() {
  useSeoMeta({ title: 'Media Hosts — Aeon', description: 'Manage media upload hosts' });

  const { user } = useCurrentUser();
  const { toast } = useToast();

  // BUD-03: auto-pull from kind:10063
  const { data: bud03Servers = [], isLoading: bud03Loading } = useBlossomServers();
  const { mutateAsync: publishServers, isPending: isPublishing } = usePublishBlossomServers();

  // Local editable list (starts from BUD-03 but user can modify)
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

  // Upload test state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadHost, setUploadHost] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ url: string; host: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const probeHost = async (url: string) => {
    // Protocol fix: Blossom uses HTTP/HTTPS — not WebSocket. Auto-correct wss:// URLs.
    let normalized = url.trim().replace(/\/+$/, '');
    if (normalized.startsWith('wss://')) normalized = 'https://' + normalized.slice(6);
    else if (normalized.startsWith('ws://')) normalized = 'http://' + normalized.slice(5);
    setProbes(prev => ({ ...prev, [url]: { status: 'probing', message: 'Probing…' } }));

    const candidates = [
      normalized + '/.well-known/nostr/nip96.json',
      normalized + '/.well-known/blossom/nip96.json',
      normalized + '/nip96.json',
      normalized + '/api/v1/nip96.json',
      normalized + '/api/status',
      normalized + '/health',
    ];

    for (const candidate of candidates) {
      try {
        const resp = await fetch(candidate, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) continue;
        const text = await resp.text();
        let data: ProbeData | null = null;
        try { data = JSON.parse(text); } catch { continue; }
        if (data) {
          const flat: ProbeData = { ...data };
          if (flat.data && typeof flat.data === 'object') Object.assign(flat, flat.data);
          setProbes(prev => ({
            ...prev,
            [url]: { status: 'ok', message: `OK at ${new URL(candidate).pathname}`, data: flat, probeUrl: candidate }
          }));
          return;
        }
      } catch { /* try next */ }
    }
    setProbes(prev => ({ ...prev, [url]: { status: 'error', message: 'No compatible endpoint found' } }));
  };

  const probeAll = () => servers.forEach(s => probeHost(s));

  const addServer = () => {
    let trimmed = newUrl.trim().replace(/\/+$/, '');
    // Protocol fix: auto-correct wss:// → https://
    if (trimmed.startsWith('wss://')) {
      trimmed = 'https://' + trimmed.slice(6);
    } else if (trimmed.startsWith('ws://')) {
      trimmed = 'http://' + trimmed.slice(5);
    }
    if (!trimmed || (!trimmed.startsWith('https://') && !trimmed.startsWith('http://'))) {
      toast({ title: 'Must start with https://', description: 'Blossom servers use HTTPS, not WebSocket (wss://)', variant: 'destructive' });
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

  /** BUD-11: build a kind:24242 Blossom authorization token */
  const buildBlossomAuth = async (fileHash: string, fileSize: number, contentType: string): Promise<string> => {
    if (!user) throw new Error('Not logged in');
    const now = Math.floor(Date.now() / 1000);
    const event = await user.signer.signEvent({
      kind: 24242,
      content: 'Upload file',
      tags: [
        ['t', 'upload'],
        ['x', fileHash],
        ['expiration', String(now + 300)],
        ['size', String(fileSize)],
        ['type', contentType || 'application/octet-stream'],
      ],
      created_at: now,
    });
    return btoa(unescape(encodeURIComponent(JSON.stringify(event))));
  };

  const handleTestUpload = async () => {
    if (!selectedFile || !uploadHost || !user) return;
    setIsUploading(true);
    setUploadProgress(0);
    setUploadResult(null);
    try {
      const fileBuffer = await selectedFile.arrayBuffer();
      setUploadProgress(20);

      // SHA-256 hash of the file (required by BUD-11)
      const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
      const fileHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      setUploadProgress(40);

      // Build BUD-11 (kind:24242) auth token
      const authB64 = await buildBlossomAuth(fileHash, selectedFile.size, selectedFile.type || 'application/octet-stream');
      setUploadProgress(60);

      // BUD-02: PUT /upload with binary body
      const uploadUrl = uploadHost.replace(/\/+$/, '') + '/upload';
      const resp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'Nostr ' + authB64,
          'Content-Type': selectedFile.type || 'application/octet-stream',
          'Content-Length': String(selectedFile.size),
          'X-SHA-256': fileHash,
        },
        body: fileBuffer,
        signal: AbortSignal.timeout(120000),
      });
      setUploadProgress(85);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
        throw new Error(errText);
      }
      const json = await resp.json().catch(() => null);
      const uploadedUrl: string | undefined = json?.url;
      if (!uploadedUrl) throw new Error('No URL in Blossom response');
      setUploadProgress(100);
      setUploadResult({ url: uploadedUrl, host: uploadHost });
      toast({ title: 'Upload successful!' });
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

        {/* BUD-03 header */}
        <Card className="shadow-sm border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flower className="h-5 w-5 text-pink-500" />
              Blossom Media Servers
              <Badge variant="secondary" className="text-xs ml-1">BUD-03</Badge>
            </CardTitle>
            <CardDescription>
              Your preferred Blossom / NIP-96 upload servers are stored on Nostr as a{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">kind:10063</code> event.
              Clients read this to know where to upload blobs on your behalf.
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

            {/* Add server */}
            <div className="flex gap-2">
              <Input
                placeholder="https://blossom.example.com"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addServer()}
                className="flex-1"
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
            return (
              <Card key={url} className={cn(
                'transition-all',
                probe.status === 'ok' && 'border-green-500/20',
                probe.status === 'error' && 'border-destructive/20',
                i === 0 && 'ring-1 ring-primary/30'
              )}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">{statusIcon(probe)}</div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{url.replace(/^https?:\/\//, '')}</span>
                        {i === 0 && <Badge className="text-[10px] px-1.5 py-0 shrink-0">Primary</Badge>}
                        {probe.status === 'ok' && <Badge className="text-[10px] px-1.5 py-0 bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30">Online</Badge>}
                        {probe.status === 'error' && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Offline</Badge>}
                      </div>
                      {probe.status === 'ok' && probe.data && (
                        <div className="text-xs text-muted-foreground">
                          {(probe.data.api_url || probe.data.apiUrl) && (
                            <span className="mr-3">API: <code>{String(probe.data.api_url || probe.data.apiUrl)}</code></span>
                          )}
                          {maxBytes && <span>Max: <strong>{formatBytes(maxBytes)}</strong></span>}
                        </div>
                      )}
                      {probe.status === 'error' && (
                        <p className="text-xs text-destructive">{probe.message}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {i > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveUp(i)} title="Move up">↑</Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => probeHost(url)}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                        <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => removeServer(url)}>
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
                <p className="text-muted-foreground text-sm">No media hosts yet. Add one above.</p>
              </CardContent>
            </Card>
          )}
        </div>

        <Separator />

        {/* NIP-98 test upload */}
        {user ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CloudUpload className="h-4 w-4 text-primary" />
                Test Upload (NIP-98 Auth)
              </CardTitle>
              <CardDescription className="text-xs">
                Upload a file using NIP-98 HTTP Auth to verify your media host config
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">File</Label>
                  <Input type="file" accept="image/*,video/*,audio/*" className="text-xs"
                    onChange={e => setSelectedFile(e.target.files?.[0] ?? null)} />
                  {selectedFile && (
                    <p className="text-xs text-muted-foreground">{selectedFile.name} — {(selectedFile.size / 1024).toFixed(1)} KB</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Host</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={uploadHost}
                    onChange={e => setUploadHost(e.target.value)}
                  >
                    <option value="">Select a host…</option>
                    {servers.filter(s => probes[s]?.status === 'ok').map(s => (
                      <option key={s} value={s}>{s.replace(/^https?:\/\//, '')}</option>
                    ))}
                  </select>
                </div>
              </div>

              {isUploading && <Progress value={uploadProgress} className="h-2" />}

              {uploadResult && (
                <div className="space-y-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">Upload successful!</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={uploadResult.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-mono text-primary hover:underline flex-1 truncate">{uploadResult.url}</a>
                    <Button variant="ghost" size="sm" className="h-6 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(uploadResult.url); toast({ title: 'URL copied!' }); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  {uploadResult.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) && (
                    <img src={uploadResult.url} alt="Uploaded" className="max-w-full max-h-48 rounded-lg object-contain" />
                  )}
                </div>
              )}

              <Button onClick={handleTestUpload} disabled={!selectedFile || !uploadHost || isUploading} className="gap-2">
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isUploading ? 'Uploading…' : 'Test Upload'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">Log in to test NIP-98 authenticated uploads.</AlertDescription>
          </Alert>
        )}
      </div>
    </AppLayout>
  );
}
