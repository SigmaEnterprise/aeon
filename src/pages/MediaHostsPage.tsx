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
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  HardDrive, Plus, Trash2, RefreshCw, Upload, CheckCircle, XCircle,
  Loader2, ExternalLink, Copy, Info, FileImage, AlertCircle
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

interface MediaHostEntry {
  url: string;
  label?: string;
}

const DEFAULT_HOSTS: MediaHostEntry[] = [
  { url: 'https://blossom.primal.net', label: 'Primal Blossom' },
  { url: 'https://nostr.build', label: 'nostr.build' },
  { url: 'https://void.cat', label: 'void.cat' },
];

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function MediaHostsPage() {
  useSeoMeta({ title: 'Media Hosts — Bitchat', description: 'Manage media upload hosts' });

  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [hosts, setHosts] = useLocalStorage<MediaHostEntry[]>('aeon:media-hosts', DEFAULT_HOSTS);
  const [probes, setProbes] = useState<Record<string, MediaHostProbe>>({});
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');

  // Test upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadHost, setUploadHost] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ url: string; host: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const probeHost = async (url: string) => {
    const normalized = url.replace(/\/+$/, '');
    setProbes(prev => ({ ...prev, [url]: { status: 'probing', message: 'Probing...' } }));

    const candidates = [
      normalized + '/.well-known/nostr/nip96.json',
      normalized + '/.well-known/blossom/nip96.json',
      normalized + '/api/v1/nip96.json',
      normalized + '/nip96.json',
      normalized + '/api/status',
      normalized + '/health',
      normalized + '/info',
    ];

    for (const candidate of candidates) {
      try {
        const resp = await fetch(candidate, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) continue;

        const text = await resp.text();
        let data: ProbeData | null = null;
        try { data = JSON.parse(text); } catch { continue; }

        if (data) {
          const flat: ProbeData = {};
          Object.assign(flat, data);
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

  const probeAll = () => hosts.forEach(h => probeHost(h.url));

  useEffect(() => {
    probeAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addHost = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    if (hosts.some(h => h.url === trimmed)) {
      toast({ title: 'Host already added', variant: 'destructive' });
      return;
    }
    const entry: MediaHostEntry = { url: trimmed };
    if (newLabel.trim()) entry.label = newLabel.trim();
    setHosts(prev => [...prev, entry]);
    setNewUrl('');
    setNewLabel('');
    probeHost(trimmed);
    toast({ title: 'Media host added' });
  };

  const removeHost = (url: string) => {
    setHosts(prev => prev.filter(h => h.url !== url));
    setProbes(prev => { const next = { ...prev }; delete next[url]; return next; });
  };

  const buildNip98Auth = async (url: string, method: string, body: ArrayBuffer | null): Promise<string> => {
    if (!user) throw new Error('Not logged in');

    const tags: string[][] = [['u', url], ['method', method]];
    if (body) {
      const hash = await sha256Hex(body);
      tags.push(['payload', hash]);
    }

    const event = await user.signer.signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags,
    });

    return btoa(unescape(encodeURIComponent(JSON.stringify(event))));
  };

  const handleTestUpload = async () => {
    if (!selectedFile || !uploadHost) return;
    if (!user) {
      toast({ title: 'Login required', variant: 'destructive' });
      return;
    }

    const probe = probes[uploadHost];
    if (!probe || probe.status !== 'ok') {
      toast({ title: 'Host not available', description: 'Probe the host first', variant: 'destructive' });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadResult(null);

    try {
      const data = probe.data;
      let apiUrl =
        data?.api_url ||
        data?.apiUrl ||
        data?.upload_url ||
        uploadHost.replace(/\/+$/, '') + '/upload';

      const fileBuffer = await selectedFile.arrayBuffer();

      setUploadProgress(30);
      const authB64 = await buildNip98Auth(apiUrl, 'POST', fileBuffer);
      setUploadProgress(50);

      const form = new FormData();
      form.append('file', selectedFile);
      form.append('size', String(selectedFile.size));
      form.append('content_type', selectedFile.type || '');

      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Nostr ' + authB64,
          Accept: 'application/json',
        },
        body: form,
        signal: AbortSignal.timeout(60000),
      });

      setUploadProgress(80);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }

      const json = await resp.json().catch(() => null);

      let uploadedUrl: string | null = null;

      if (json) {
        uploadedUrl =
          json.nip94_event?.tags?.find((t: string[]) => t[0] === 'url')?.[1] ||
          json.url ||
          json.download_url ||
          null;
      }

      if (!uploadedUrl) {
        const loc = resp.headers.get('location');
        if (loc) uploadedUrl = loc;
      }

      if (!uploadedUrl) {
        const text = JSON.stringify(json || {});
        const m = text.match(/https?:\/\/[^\s"']+/);
        if (m) uploadedUrl = m[0];
      }

      if (!uploadedUrl) throw new Error('No URL returned from host');

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
    const candidates = [
      probe.data.plans?.free?.max_byte_size,
      probe.data.max_byte_size,
      probe.data.max_size,
      probe.data.maxSize,
    ].filter((v): v is number => typeof v === 'number');
    return candidates[0] ?? null;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

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
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              Media Hosts
            </CardTitle>
            <CardDescription>
              Configure Blossom and NIP-96 compatible media upload servers.
              Hosts are probed automatically to check availability and capabilities.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs">Host URL</Label>
                <Input
                  placeholder="https://blossom.example.com"
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addHost()}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Label (optional)</Label>
                <Input
                  placeholder="My server"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={addHost} className="gap-1.5" disabled={!newUrl.trim()}>
                <Plus className="h-4 w-4" />
                Add Host
              </Button>
              <Button variant="outline" onClick={probeAll} className="gap-1.5">
                <RefreshCw className="h-4 w-4" />
                Probe All
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Host list */}
        <div className="space-y-3">
          {hosts.map(host => {
            const probe = probes[host.url] ?? { status: 'unknown' as const };
            const maxBytes = getMaxBytes(probe);

            return (
              <Card key={host.url} className={cn(
                "transition-all",
                probe.status === 'ok' && "border-green-500/20",
                probe.status === 'error' && "border-destructive/20"
              )}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{statusIcon(probe)}</div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{host.label || host.url.replace(/^https?:\/\//, '')}</span>
                        {host.label && <span className="text-xs text-muted-foreground font-mono">{host.url}</span>}
                        {probe.status === 'ok' && <Badge className="text-xs bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30">Online</Badge>}
                        {probe.status === 'error' && <Badge variant="destructive" className="text-xs">Offline</Badge>}
                        {probe.status === 'probing' && <Badge variant="secondary" className="text-xs">Checking…</Badge>}
                      </div>

                      {probe.status === 'ok' && probe.data && (
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {(probe.data.api_url || probe.data.apiUrl) && (
                            <p>API: <span className="font-mono">{(probe.data.api_url || probe.data.apiUrl) as string}</span></p>
                          )}
                          {maxBytes && (
                            <p>Max upload: <span className="font-medium">{formatBytes(maxBytes)}</span></p>
                          )}
                          {probe.probeUrl && (
                            <p>NIP: <span className="font-mono">{probe.probeUrl.includes('nip96') ? 'NIP-96' : 'Blossom'}</span></p>
                          )}
                        </div>
                      )}

                      {probe.status === 'error' && probe.message && (
                        <p className="text-xs text-destructive">{probe.message}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => probeHost(host.url)} title="Re-probe">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                        <a href={host.url} target="_blank" rel="noopener noreferrer" title="Open">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => removeHost(host.url)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {hosts.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <HardDrive className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No media hosts configured. Add one above.</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Test upload section */}
        {user && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" />
                Test Upload (NIP-98)
              </CardTitle>
              <CardDescription className="text-xs">
                Upload a file using NIP-98 auth to test your media host configuration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">File to upload</Label>
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
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={uploadHost}
                    onChange={e => setUploadHost(e.target.value)}
                  >
                    <option value="">Select a host...</option>
                    {hosts
                      .filter(h => probes[h.url]?.status === 'ok')
                      .map(h => (
                        <option key={h.url} value={h.url}>{h.label || h.url}</option>
                      ))}
                  </select>
                </div>
              </div>

              {isUploading && (
                <Progress value={uploadProgress} className="h-2" />
              )}

              {uploadResult && (
                <div className="space-y-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">Upload successful!</span>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(uploadResult.url);
                        toast({ title: 'URL copied!' });
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  {uploadResult.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) && (
                    <img src={uploadResult.url} alt="Uploaded" className="max-w-full max-h-48 rounded-lg object-contain" />
                  )}
                </div>
              )}

              <Button
                onClick={handleTestUpload}
                disabled={!selectedFile || !uploadHost || isUploading}
                className="gap-2"
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isUploading ? 'Uploading…' : 'Test Upload'}
              </Button>
            </CardContent>
          </Card>
        )}

        {!user && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Log in to test NIP-98 authenticated uploads to your media hosts.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AppLayout>
  );
}
