import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { AppLayout } from '@/components/AppLayout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { Search, Copy, ExternalLink, Globe, Zap, BadgeCheck } from 'lucide-react';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';

interface ProfileResult {
  pubkey: string;
  npub: string;
  metadata: NostrMetadata;
  event: NostrEvent;
}

function decodePubkey(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') return decoded.data as string;
    if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey;
  } catch { /* ignore */ }
  return null;
}

export function DirectoryPage() {
  useSeoMeta({
    title: 'Directory — Aeon',
    description: 'Search Nostr profiles',
  });

  const { nostr } = useNostr();
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  const { data: results, isLoading } = useQuery<ProfileResult[]>({
    queryKey: ['directory', 'search', activeSearch],
    queryFn: async () => {
      if (!activeSearch) return [];

      const pubkey = decodePubkey(activeSearch);
      const filters: Parameters<typeof nostr.query>[0] = [];

      if (pubkey) {
        filters.push({ kinds: [0], authors: [pubkey], limit: 1 });
      } else {
        // Search by name - get recent kind 0 events and filter
        filters.push({ kinds: [0], limit: 50 });
      }

      const events = await nostr.query(filters, { signal: AbortSignal.timeout(8000) });

      const profiles: ProfileResult[] = [];

      for (const event of events) {
        try {
          const metadata = JSON.parse(event.content) as NostrMetadata;
          if (
            !pubkey &&
            !Object.values(metadata).some(v =>
              typeof v === 'string' && v.toLowerCase().includes(activeSearch.toLowerCase())
            )
          ) {
            continue;
          }
          profiles.push({
            pubkey: event.pubkey,
            npub: nip19.npubEncode(event.pubkey),
            metadata,
            event,
          });
        } catch { /* ignore */ }
      }

      return profiles;
    },
    enabled: !!activeSearch,
    staleTime: 60000,
  });

  const handleSearch = () => {
    if (!searchInput.trim()) return;
    setActiveSearch(searchInput.trim());
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied!` });
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="shadow-sm">
          <CardContent className="p-4 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" />
                Directory
              </h2>
              <p className="text-sm text-muted-foreground">
                Search by npub, hex pubkey, or name
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="npub1... or hex pubkey or name..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} className="gap-2">
                <Search className="h-4 w-4" />
                Search
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-14 w-14 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : results && results.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground text-sm">No profiles found. Try a different search.</p>
            </CardContent>
          </Card>
        ) : results ? (
          <div className="space-y-4">
            {results.map(profile => (
              <ProfileCard
                key={profile.pubkey}
                profile={profile}
                onCopy={handleCopy}
              />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground text-sm">Search for a profile by npub, hex pubkey, or name.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

interface ProfileCardProps {
  profile: ProfileResult;
  onCopy: (text: string, label: string) => void;
}

function ProfileCard({ profile, onCopy }: ProfileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { metadata, npub, pubkey } = profile;
  const displayName = metadata?.name ?? genUserName(pubkey);

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <Avatar className="h-14 w-14 ring-2 ring-border shrink-0">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="text-lg font-bold">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">{displayName}</span>
                {metadata?.display_name && metadata.display_name !== metadata.name && (
                  <span className="text-sm text-muted-foreground">@{metadata.display_name}</span>
                )}
                {metadata?.nip05 && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <BadgeCheck className="h-2.5 w-2.5" />
                    {metadata.nip05}
                  </Badge>
                )}
              </div>
              <p className="text-xs font-mono text-muted-foreground truncate">{npub.slice(0, 32)}…</p>
            </div>

            {metadata?.about && (
              <p className="text-sm text-muted-foreground line-clamp-2">{metadata.about}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {metadata?.website && (
                <a href={metadata.website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <Globe className="h-3 w-3" />
                  {metadata.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {metadata?.lud16 && (
                <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                  <Zap className="h-3 w-3" />
                  {metadata.lud16}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onCopy(npub, 'npub')}>
                <Copy className="h-3 w-3" />npub
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onCopy(pubkey, 'Hex pubkey')}>
                <Copy className="h-3 w-3" />hex
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onCopy(JSON.stringify(metadata, null, 2), 'Profile JSON')}>
                <Copy className="h-3 w-3" />JSON
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
                <a href={`https://njump.me/${npub}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3" />njump
                </a>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
