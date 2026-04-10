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
  Bell, Telescope, Users, MessageSquare, Repeat2, Heart,
  ShieldCheck, Cpu, Trash2, MessageCircle, Hash,
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
        icon: <Repeat2 className="h-5 w-5" />,
        title: 'Reposts',
        description:
          'Repost any note (Kind 6) or generic content (Kind 16) with a single click. Reposts appear in the feed with proper attribution and a "Reposted by" label.',
        nips: ['NIP-18'],
        badge: 'K6 · K16',
        badgeVariant: 'secondary',
      },
      {
        icon: <Heart className="h-5 w-5" />,
        title: 'Reactions',
        description:
          'Like, dislike, or send any emoji reaction to notes. Reaction counts are displayed on every note card, and your reaction is highlighted when active.',
        nips: ['NIP-25'],
      },
      {
        icon: <MessageCircle className="h-5 w-5" />,
        title: 'Comments & Replies',
        description:
          'Reply to notes in threaded conversations. NIP-10 threading differentiates direct replies, root replies, and thread mentions — correctly labelled in every view.',
        nips: ['NIP-01', 'NIP-10'],
      },
      {
        icon: <Bell className="h-5 w-5" />,
        title: 'Notifications',
        description:
          'Get notified when someone replies to your notes, mentions you, reacts to your content, or sends a zap. Tabbed by type (All / Reposts / Replies / Likes / Zaps) with live badge counts.',
        nips: ['NIP-01', 'NIP-25', 'NIP-57'],
        badge: 'Live',
        badgeVariant: 'default',
      },
      {
        icon: <ShieldCheck className="h-5 w-5" />,
        title: 'VertexLab Reputation Filtering',
        description:
          'Enable "High Signal Only" in the notifications panel to hide likely-spam accounts. Powered by VertexLab PageRank scoring — accounts are scored on demand without leaking your data.',
        nips: ['NIP-01'],
        badge: 'Anti-Spam',
        badgeVariant: 'secondary',
      },
      {
        icon: <Trash2 className="h-5 w-5" />,
        title: 'Event Deletions (NIP-09)',
        description:
          'Notifications whose referenced event has been deleted by the author are automatically filtered out — no phantom likes or comments from deleted posts.',
        nips: ['NIP-09'],
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
        badge: 'Editor',
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
      },
      {
        icon: <Eye className="h-5 w-5" />,
        title: 'Live Markdown Preview',
        description:
          'See exactly how your article will render as you type. The preview pane handles GFM tables, code blocks, blockquotes, and inline nostr: links per NIP-27.',
        nips: ['NIP-27', 'NIP-21'],
        path: '/articles/new',
        cta: 'Try it',
      },
      {
        icon: <MessageSquare className="h-5 w-5" />,
        title: 'Article Comments',
        description:
          'Readers can post NIP-22 comments directly on articles. Comment threads are displayed below each article with full reply support and author avatars.',
        nips: ['NIP-22'],
        path: '/articles',
        cta: 'Read Articles',
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
      {
        icon: <FileText className="h-5 w-5" />,
        title: 'Custom Feeds',
        description:
          'Follow specific pubkeys and build custom curated feeds. Great for monitoring a focused set of accounts without mixing in the global stream.',
        nips: ['NIP-01', 'NIP-02'],
        path: '/custom-feed',
        cta: 'Custom Feeds',
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
      {
        icon: <Users className="h-5 w-5" />,
        title: 'Marmot Encrypted Groups',
        description:
          'MLS (RFC 9420) encrypted group chat over Nostr. Create groups, invite members via NIP-59 gift-wrapped invitations (Kind 444), and send end-to-end encrypted messages (Kind 445). Provides forward secrecy and post-compromise security.',
        nips: ['NIP-59'],
        path: '/marmot',
        cta: 'Marmot Groups',
        badge: 'MLS · Alpha',
        badgeVariant: 'secondary',
      },
      {
        icon: <Cpu className="h-5 w-5" />,
        title: 'MLS Key Packages',
        description:
          'Publish your MLS Key Package (Kind 443) so others can invite you to Marmot groups. Uses the MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 ciphersuite for strong identity binding.',
        nips: ['NIP-59'],
        path: '/marmot',
        cta: 'Publish Key Package',
        badge: 'K443',
        badgeVariant: 'outline',
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
      },
      {
        icon: <Hash className="h-5 w-5" />,
        title: '@Mention Autocomplete',
        description:
          'Type @ while composing a note or article to trigger live autocomplete for Nostr profiles. The mention is inserted as a nostr:npub1... link conforming to NIP-21.',
        nips: ['NIP-21', 'NIP-27'],
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
          'Browse raw events from any relay by pasting its WebSocket URL. Shows relay NIP-11 metadata (name, description, supported NIPs, limitations), live connection status, and recent notes.',
        nips: ['NIP-11'],
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
    description: 'Everything Aeon can do: NIP-23 articles, NIP-17 private DMs, Marmot MLS group chat, Lightning zaps, relay management, and more.',
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
            long-form publishing, shielded DMs, MLS group chat, Lightning zaps, and more — all built on open protocols.
          </p>

          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {['NIP-01', 'NIP-10', 'NIP-17', 'NIP-18', 'NIP-22', 'NIP-23', 'NIP-44', 'NIP-57', 'NIP-59', 'NIP-65', 'MLS·RFC9420', 'NWC'].map(nip => (
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
