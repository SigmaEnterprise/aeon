/**
 * FeaturesPage — A clean, user-facing feature reference for Aeon.
 * Lists every major capability with the NIP it implements,
 * a short description, and a direct link to try it.
 */

import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { AppLayout } from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AeonLogo } from '@/components/AeonLogo';
import {
  ArrowRight, Globe, Star, BookOpen, User, Lock, Key,
  Radio, Package, Zap, Wallet, Palette, Search, Shield,
  FileText, PenSquare, FilePen, Eye, Upload, Link as LinkIcon,
  Bell, Telescope,
} from 'lucide-react';

// ─── Data ─────────────────────────────────────────────────────────────────────

interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
  nips?: string[];
  path?: string;
  cta?: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'outline' | 'destructive';
}

interface FeatureGroup {
  heading: string;
  emoji: string;
  color: string;
  features: Feature[];
}

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    heading: 'Social Feed',
    emoji: '📡',
    color: 'text-blue-500',
    features: [
      {
        icon: <Globe className="h-5 w-5" />,
        title: 'Global Feed',
        description:
          'A real-time stream of notes, reposts, and long-form articles from the whole Nostr network. Supports infinite scroll so you never run out of content.',
        nips: ['NIP-01', 'NIP-10'],
        path: '/feed',
        cta: 'Open Feed',
      },
      {
        icon: <Star className="h-5 w-5" />,
        title: 'Following Feed',
        description:
          'See only the notes from people you follow. Your contact list is stored on the protocol so it syncs across every Nostr client you use.',
        nips: ['NIP-02'],
        path: '/feed',
        cta: 'Following',
      },
      {
        icon: <Search className="h-5 w-5" />,
        title: 'Hashtag Search',
        description:
          'Search any hashtag or keyword and get a live feed of matching notes. Results arrive in real time from your connected relays.',
        nips: ['NIP-12'],
        path: '/feed',
        cta: 'Search',
      },
      {
        icon: <Bell className="h-5 w-5" />,
        title: 'Notifications',
        description:
          'Get notified when someone replies to your notes, mentions you, reacts to your content, or sends a zap. Available from the bell icon in the header.',
        nips: ['NIP-01', 'NIP-25'],
        badge: 'Live',
        badgeVariant: 'default',
      },
    ],
  },
  {
    heading: 'Long-form Articles',
    emoji: '🗞️',
    color: 'text-violet-500',
    features: [
      {
        icon: <BookOpen className="h-5 w-5" />,
        title: 'Browse Articles',
        description:
          'Discover long-form articles published across the Nostr network. Each card shows a hero image, summary, tags, author, and reading time estimate.',
        nips: ['NIP-23'],
        path: '/articles',
        cta: 'Browse',
      },
      {
        icon: <PenSquare className="h-5 w-5" />,
        title: 'Write & Publish',
        description:
          'A full Markdown editor with Write, Preview, and Split-screen modes. Add a title, summary, header image, and hashtags. Publish when ready — edits replace the original cleanly.',
        nips: ['NIP-23'],
        path: '/articles/new',
        cta: 'New Article',
        badge: 'New',
        badgeVariant: 'default',
      },
      {
        icon: <FilePen className="h-5 w-5" />,
        title: 'Drafts',
        description:
          'Save work-in-progress as a draft (kind:30024). Every save pushes the draft to your relays immediately so your writing is always backed up globally — no local-only storage.',
        nips: ['NIP-23'],
        path: '/articles',
        cta: 'My Articles',
        badge: 'New',
        badgeVariant: 'default',
      },
      {
        icon: <Eye className="h-5 w-5" />,
        title: 'Live Markdown Preview',
        description:
          'See exactly how your article will render as you type. The preview pane handles GFM tables, code blocks, blockquotes, and inline nostr: links per NIP-27.',
        nips: ['NIP-27', 'NIP-21'],
        path: '/articles/new',
        cta: 'Try it',
        badge: 'New',
        badgeVariant: 'default',
      },
    ],
  },
  {
    heading: 'Identity & Profiles',
    emoji: '👤',
    color: 'text-green-500',
    features: [
      {
        icon: <User className="h-5 w-5" />,
        title: 'Profile',
        description:
          'View and edit your public profile: display name, bio, website, avatar, and banner. Changes are published as a kind:0 event and sync everywhere.',
        nips: ['NIP-01'],
        path: '/profile',
        cta: 'My Profile',
      },
      {
        icon: <Search className="h-5 w-5" />,
        title: 'Directory',
        description:
          'Find anyone on Nostr by pasting an npub, hex public key, or searching by display name. Quickly follow, zap, or DM from their profile.',
        nips: ['NIP-19'],
        path: '/directory',
        cta: 'Directory',
      },
      {
        icon: <Key className="h-5 w-5" />,
        title: 'Key Management',
        description:
          'Generate a brand-new Nostr keypair right in your browser. Encrypt and save it with a strong password (AES-256-GCM + PBKDF2), or export an encrypted backup file.',
        nips: ['NIP-19'],
        path: '/keys',
        cta: 'Manage Keys',
      },
    ],
  },
  {
    heading: 'Private Messaging',
    emoji: '🔒',
    color: 'text-rose-500',
    features: [
      {
        icon: <Lock className="h-5 w-5" />,
        title: 'Shielded DMs (NIP-17)',
        description:
          'The most private messaging on Nostr. Messages are triple-wrapped: encrypted rumour → NIP-44 seal → gift wrap with an ephemeral key. Relays see only an opaque gift-wrap — no sender, no timestamp, no content.',
        nips: ['NIP-17', 'NIP-44', 'NIP-59'],
        path: '/shielded',
        cta: 'Open DMs',
        badge: 'Max Privacy',
        badgeVariant: 'destructive',
      },
      {
        icon: <Shield className="h-5 w-5" />,
        title: 'Metadata-Free Protocol',
        description:
          'Randomised timestamps on every seal and gift wrap prevent timing correlation. Each gift wrap uses a fresh ephemeral signing key. The inner rumour is unsigned for deniability.',
        nips: ['NIP-59'],
      },
    ],
  },
  {
    heading: 'Lightning & Zaps',
    emoji: '⚡',
    color: 'text-yellow-500',
    features: [
      {
        icon: <Zap className="h-5 w-5" />,
        title: 'Zap Notes',
        description:
          'Send Lightning payments directly to note authors. Tap the ⚡ button on any note, choose an amount, and pay — the zap receipt is published back to Nostr for the world to see.',
        nips: ['NIP-57'],
      },
      {
        icon: <Wallet className="h-5 w-5" />,
        title: 'Nostr Wallet Connect',
        description:
          'Paste a nostr+walletconnect:// URI from any NWC-compatible wallet (e.g. Mutiny, Alby, Coinos) and zap without leaving the app. No invoice copy-paste.',
        nips: ['NWC'],
        badge: 'NWC',
        badgeVariant: 'secondary',
      },
      {
        icon: <Zap className="h-5 w-5" />,
        title: 'WebLN',
        description:
          'If you have a browser extension like Alby installed, Aeon detects it automatically and uses it for zap payments. Nothing to configure.',
        nips: ['NIP-57'],
      },
    ],
  },
  {
    heading: 'Media & Files',
    emoji: '📦',
    color: 'text-orange-500',
    features: [
      {
        icon: <Upload className="h-5 w-5" />,
        title: 'Blossom File Uploads',
        description:
          'Attach images, video, and audio to notes or article headers. Files are uploaded to your configured Blossom server with BUD-11 authentication — no third-party account needed.',
        nips: ['NIP-96', 'NIP-98'],
        path: '/media-hosts',
        cta: 'Media Hosts',
      },
      {
        icon: <Package className="h-5 w-5" />,
        title: 'Drag-and-Drop Headers',
        description:
          'When writing an article, drag an image straight onto the header image field. It uploads automatically to Blossom and fills in the URL — no copy-paste required.',
        nips: ['NIP-23'],
        path: '/articles/new',
        cta: 'Try in Editor',
        badge: 'New',
        badgeVariant: 'default',
      },
    ],
  },
  {
    heading: 'Relays & Network',
    emoji: '🌐',
    color: 'text-sky-500',
    features: [
      {
        icon: <Radio className="h-5 w-5" />,
        title: 'Relay Manager',
        description:
          'Add, remove, and configure read/write permissions for your Nostr relays. Your list is published as a kind:10002 event so other clients pick it up automatically.',
        nips: ['NIP-65'],
        path: '/relays',
        cta: 'Relays',
      },
      {
        icon: <Telescope className="h-5 w-5" />,
        title: 'Relay Explorer',
        description:
          'Browse raw events from any relay by pasting its WebSocket URL. Useful for debugging, exploring niche relays, or verifying your published events.',
        path: '/relay-explorer',
        cta: 'Explorer',
      },
      {
        icon: <LinkIcon className="h-5 w-5" />,
        title: 'NIP-19 Identifier Viewer',
        description:
          'Paste any npub, note, nevent, nprofile, or naddr into the address bar and Aeon will decode and display it with full context — author, relay hints, event content, and more.',
        nips: ['NIP-19', 'NIP-21'],
      },
    ],
  },
  {
    heading: 'Appearance',
    emoji: '🎨',
    color: 'text-pink-500',
    features: [
      {
        icon: <Palette className="h-5 w-5" />,
        title: '15 Built-in Themes',
        description:
          'Switch between Default Light, Dark, Solarized Light/Dark, Terminal, Ocean, Forest, Desert, Vintage, Neon, Monokai, Dracula, Gruvbox Light/Dark, and Midnight. The picker is always in the header.',
        badge: '15 themes',
        badgeVariant: 'secondary',
      },
      {
        icon: <Eye className="h-5 w-5" />,
        title: 'Theme-aware Typography',
        description:
          'Article prose, code blocks, blockquotes, and tables all inherit your active theme\'s colour palette. Dracula stays purple; Terminal stays green — everywhere.',
      },
    ],
  },
];

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <div className="group relative flex flex-col gap-3 p-4 rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all duration-200">
      {/* Icon + title row */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-2 rounded-lg bg-primary/8 text-primary group-hover:bg-primary/15 transition-colors shrink-0">
          {feature.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm leading-snug">{feature.title}</h3>
            {feature.badge && (
              <Badge variant={feature.badgeVariant ?? 'secondary'} className="text-[10px] px-1.5 h-4 py-0">
                {feature.badge}
              </Badge>
            )}
          </div>
          {/* NIP tags */}
          {feature.nips && feature.nips.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {feature.nips.map(nip => (
                <span key={nip} className="text-[10px] font-mono px-1.5 py-0 rounded bg-muted text-muted-foreground">
                  {nip}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {feature.description}
      </p>

      {/* CTA */}
      {feature.path && feature.cta && (
        <div className="mt-auto pt-1">
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-primary hover:text-primary">
            <Link to={feature.path}>
              {feature.cta}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function FeatureSection({ group }: { group: FeatureGroup }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xl leading-none">{group.emoji}</span>
        <h2 className={`font-bold text-base ${group.color}`}>{group.heading}</h2>
        <Separator className="flex-1 opacity-30" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {group.features.map(f => (
          <FeatureCard key={f.title} feature={f} />
        ))}
      </div>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function FeaturesPage() {
  useSeoMeta({
    title: 'Features — Aeon',
    description: 'Everything Aeon can do: NIP-23 articles, NIP-17 private DMs, Lightning zaps, relay management, and more.',
  });

  const totalFeatures = FEATURE_GROUPS.reduce((acc, g) => acc + g.features.length, 0);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-8">

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-8 text-center space-y-3">
          {/* Decorative background gradient */}
          <div
            className="absolute inset-0 -z-10 opacity-20"
            style={{
              background:
                'radial-gradient(ellipse 70% 50% at 50% 0%, hsl(var(--primary)) 0%, transparent 70%)',
            }}
          />

          <div className="flex justify-center mb-1">
            <AeonLogo size={48} />
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-500 via-indigo-500 to-sky-500 bg-clip-text text-transparent">
            Aeon Features
          </h1>

          <p className="text-muted-foreground max-w-xl mx-auto text-sm leading-relaxed">
            A privacy-first Nostr client with {totalFeatures} features across social feeds,
            long-form publishing, shielded DMs, Lightning zaps, and more — all built on open protocols.
          </p>

          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {['NIP-01', 'NIP-17', 'NIP-23', 'NIP-44', 'NIP-57', 'NIP-59', 'NIP-65', 'NWC'].map(nip => (
              <span key={nip} className="text-xs font-mono px-2 py-0.5 rounded-full border bg-muted text-muted-foreground">
                {nip}
              </span>
            ))}
          </div>
        </div>

        {/* ── Feature groups ─────────────────────────────────────────────── */}
        {FEATURE_GROUPS.map(group => (
          <FeatureSection key={group.heading} group={group} />
        ))}

        {/* ── Footer note ────────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-muted/30 px-5 py-4 text-center text-xs text-muted-foreground space-y-1">
          <p>
            Aeon is fully open-source and built on the{' '}
            <a
              href="https://github.com/nostr-protocol/nostr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Nostr protocol
            </a>.
            Your keys, your data, your relays — always.
          </p>
          <p>
            Built with{' '}
            <a href="https://shakespeare.diy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Shakespeare
            </a>
            {' '}· React 19 · TailwindCSS · Nostrify
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
