/**
 * Private DMs — NIP-17 (NIP-44 + NIP-59 Gift Wrap)
 *
 * Extension signer path:
 *  - SEND: Uses signer.nip44.encrypt for the seal content, then wraps with
 *    an ephemeral key (raw nostr-tools, no private key needed for this step).
 *  - DECRYPT: Uses signer.nip44.decrypt for both the gift-wrap→seal and
 *    seal→rumor layers, so extension signers (Alby, nos2x, etc.) that expose
 *    nip44 can decrypt without ever exposing the private key.
 *
 * Fallback: If the extension does NOT support nip44, the user can paste their
 * nsec/hex key in the manual key field for decryption only.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { nip19, nip44, generateSecretKey, getPublicKey, finalizeEvent, getEventHash } from 'nostr-tools';
import { AppLayout } from '@/components/AppLayout';
import { LoginArea } from '@/components/auth/LoginArea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { genUserName } from '@/lib/genUserName';
import {
  ShieldCheck, Send, Lock, Loader2, Info, ArrowLeft,
  MessageSquare, User, CheckCircle2, Key, RefreshCw, AlertCircle,
} from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

// ─── Hex helpers ─────────────────────────────────────────────────────────────
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}
function decodePubkey(input: string): string | null {
  const t = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return t.toLowerCase();
  try {
    const d = nip19.decode(t);
    if (d.type === 'npub') return d.data as string;
    if (d.type === 'nprofile') return (d.data as { pubkey: string }).pubkey;
  } catch { /* ignore */ }
  return null;
}
const randomNow = () => Math.round(Date.now() / 1000 - Math.random() * 2 * 24 * 60 * 60);

// ─── NIP-59 gift-wrap (extension signer path) ─────────────────────────────
/**
 * Build a gift wrap using the extension signer for the seal (NIP-44 via
 * signer.nip44.encrypt), and an ephemeral raw key for the outer wrap.
 * No private key exposure needed.
 */
async function buildGiftWrapViaSigner(
  rumor: Omit<NostrEvent, 'sig'>,
  signer: { nip44: { encrypt: (pk: string, plain: string) => Promise<string> }; signEvent: (ev: object) => Promise<NostrEvent> },
  recipientPubkey: string,
): Promise<NostrEvent> {
  // 1. Seal (kind:13): encrypt rumor for recipient via signer.nip44
  const sealContent = await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor));
  const seal = await signer.signEvent({
    kind: 13,
    content: sealContent,
    created_at: randomNow(),
    tags: [],
  });

  // 2. Gift wrap (kind:1059): encrypt seal with ephemeral raw key
  const ephemeralKey = generateSecretKey();
  const ck = nip44.v2.utils.getConversationKey(bytesToHex(ephemeralKey), recipientPubkey);
  const wrapContent = nip44.v2.encrypt(JSON.stringify(seal), ck);
  const wrapTemplate = {
    kind: 1059,
    content: wrapContent,
    created_at: randomNow(),
    tags: [['p', recipientPubkey]] as string[][],
  };
  return finalizeEvent(wrapTemplate, ephemeralKey) as NostrEvent;
}

/** Build gift wrap with raw private key bytes (nsec fallback path) */
async function buildGiftWrapViaKey(
  rumor: Omit<NostrEvent, 'sig'>,
  senderPrivKeyBytes: Uint8Array,
  recipientPubkey: string,
): Promise<NostrEvent> {
  const ck1 = nip44.v2.utils.getConversationKey(bytesToHex(senderPrivKeyBytes), recipientPubkey);
  const sealContent = nip44.v2.encrypt(JSON.stringify(rumor), ck1);
  const seal = finalizeEvent({ kind: 13, content: sealContent, created_at: randomNow(), tags: [] }, senderPrivKeyBytes);

  const ephemeralKey = generateSecretKey();
  const ck2 = nip44.v2.utils.getConversationKey(bytesToHex(ephemeralKey), recipientPubkey);
  const wrapContent = nip44.v2.encrypt(JSON.stringify(seal), ck2);
  return finalizeEvent({
    kind: 1059, content: wrapContent, created_at: randomNow(), tags: [['p', recipientPubkey]],
  }, ephemeralKey) as NostrEvent;
}

// ─── Unwrap via extension signer (nip44.decrypt) ─────────────────────────
async function unwrapViaExtension(
  wrap: NostrEvent,
  signer: { nip44: { decrypt: (pk: string, cipher: string) => Promise<string> } },
): Promise<(Omit<NostrEvent, 'sig'> & { sig?: string }) | null> {
  try {
    // Layer 1: decrypt gift wrap content (signer key + wrap.pubkey as convo partner)
    const sealJson = await signer.nip44.decrypt(wrap.pubkey, wrap.content);
    const seal: NostrEvent = JSON.parse(sealJson);
    // Layer 2: decrypt seal content (signer key + seal.pubkey as convo partner)
    const rumorJson = await signer.nip44.decrypt(seal.pubkey, seal.content);
    const rumor = JSON.parse(rumorJson);
    if (rumor.pubkey !== seal.pubkey) return null;
    return rumor;
  } catch {
    return null;
  }
}

/** Unwrap via raw private key bytes */
async function unwrapViaKey(
  wrap: NostrEvent,
  privBytes: Uint8Array,
): Promise<(Omit<NostrEvent, 'sig'> & { sig?: string }) | null> {
  try {
    const ck1 = nip44.v2.utils.getConversationKey(bytesToHex(privBytes), wrap.pubkey);
    const sealJson = nip44.v2.decrypt(wrap.content, ck1);
    const seal: NostrEvent = JSON.parse(sealJson);
    const ck2 = nip44.v2.utils.getConversationKey(bytesToHex(privBytes), seal.pubkey);
    const rumorJson = nip44.v2.decrypt(seal.content, ck2);
    const rumor = JSON.parse(rumorJson);
    if (rumor.pubkey !== seal.pubkey) return null;
    return rumor;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────
interface DecryptedMsg {
  id: string; content: string; kind: number; created_at: number;
  senderPubkey: string; direction: 'sent' | 'received'; subject?: string;
  /** The conversation partner pubkey (for sent messages: recipient, for received: sender) */
  conversationPartner: string;
}
interface ConversationContact { pubkey: string; lastSeen: number; }

// ─── Sub-components ───────────────────────────────────────────────────────
function ContactRow({ pubkey, isActive, onClick }: { pubkey: string; isActive: boolean; onClick: () => void }) {
  const author = useAuthor(pubkey);
  const meta = author.data?.metadata;
  const name = meta?.name ?? genUserName(pubkey);
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left
        ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={meta?.picture} /><AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate font-medium">{name}</span>
    </button>
  );
}

function MessageBubble({ msg }: { msg: DecryptedMsg }) {
  const isSent = msg.direction === 'sent';
  return (
    <div className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm
        ${isSent ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted rounded-tl-sm'}`}>
        {msg.subject && <p className="text-xs font-semibold opacity-70 mb-1">📌 {msg.subject}</p>}
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-[10px] mt-1 ${isSent ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
          {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

function RecipientHeader({ pubkey, onBack }: { pubkey: string; onBack: () => void }) {
  const author = useAuthor(pubkey);
  const meta = author.data?.metadata;
  const name = meta?.name ?? genUserName(pubkey);
  const npub = nip19.npubEncode(pubkey);
  return (
    <div className="p-3 flex items-center gap-3 shrink-0">
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 md:hidden" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Avatar className="h-8 w-8">
        <AvatarImage src={meta?.picture} /><AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{name}</p>
        <p className="text-[10px] font-mono text-muted-foreground truncate">{npub.slice(0, 24)}…</p>
      </div>
      <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
        <ShieldCheck className="h-2.5 w-2.5" />NIP-17
      </Badge>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
export function ShieldedPage() {
  useSeoMeta({ title: 'Private DMs — Aeon', description: 'NIP-17 encrypted DMs' });

  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();

  // Support deep-linking from profiles: /shielded with state.recipientPubkey
  const initialRecipient = (location.state as { recipientPubkey?: string } | null)?.recipientPubkey ?? null;

  const [recipientInput, setRecipientInput] = useState('');
  const [activeRecipient, setActiveRecipient] = useState<string | null>(initialRecipient);
  const [contacts, setContacts] = useState<ConversationContact[]>(() => {
    if (initialRecipient) return [{ pubkey: initialRecipient, lastSeen: 0 }];
    return [];
  });
  const [messages, setMessages] = useState<DecryptedMsg[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [subjectInput, setSubjectInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Detect extension nip44 support
  const extensionSupportsNip44 = !!(user?.signer?.nip44);
  const loginType = (user as { loginType?: string })?.loginType;
  const isExtension = !manualKey && extensionSupportsNip44;

  const { data: wraps, isLoading: loadingWraps, refetch } = useQuery<NostrEvent[]>({
    queryKey: ['nip17-wraps', user?.pubkey],
    queryFn: async () => {
      if (!user) return [];
      return nostr.query([{ kinds: [1059], '#p': [user.pubkey], limit: 200 }], { signal: AbortSignal.timeout(10000) });
    },
    enabled: !!user,
    staleTime: 30000,
  });

  // Resolve private key bytes (manual fallback only)
  const getPrivKeyBytes = useCallback((): Uint8Array | null => {
    if (!manualKey.trim()) return null;
    const k = manualKey.trim();
    if (k.startsWith('nsec')) {
      try {
        const d = nip19.decode(k);
        if (d.type === 'nsec') return d.data as Uint8Array;
      } catch { return null; }
    }
    if (/^[0-9a-fA-F]{64}$/.test(k)) return hexToBytes(k);
    return null;
  }, [manualKey]);

  const handleDecryptAll = async () => {
    if (!wraps?.length || !user) return;

    // Prefer extension nip44 path
    const signerNip44 = user.signer?.nip44;
    const privBytes = !signerNip44 ? getPrivKeyBytes() : null;

    if (!signerNip44 && !privBytes) {
      setShowKeyInput(true);
      toast({ title: 'Private key needed', description: 'Your signer does not expose NIP-44. Enter your nsec below.' });
      return;
    }

    setIsDecrypting(true);

    // Map: conversationPartnerPubkey → DecryptedMsg[]
    // Correctly isolates sent/received messages per contact.
    const byPartner = new Map<string, DecryptedMsg[]>();

    for (const wrap of wraps) {
      let rumor: (Omit<NostrEvent, 'sig'> & { sig?: string }) | null = null;
      if (signerNip44) {
        rumor = await unwrapViaExtension(wrap, user.signer as Parameters<typeof unwrapViaExtension>[1]);
      } else if (privBytes) {
        rumor = await unwrapViaKey(wrap, privBytes);
      }
      if (!rumor || (rumor.kind !== 14 && rumor.kind !== 15)) continue;

      const isSent = rumor.pubkey === user.pubkey;
      const subject = rumor.tags?.find(t => t[0] === 'subject')?.[1];

      // Determine the conversation partner:
      //   - If WE sent it: partner is the first 'p' tag recipient
      //   - If THEY sent it: partner is the sender (rumor.pubkey)
      let partner: string;
      if (isSent) {
        const pTag = rumor.tags?.find(t => t[0] === 'p')?.[1];
        if (!pTag || pTag === user.pubkey) continue; // Skip self-messages without valid recipient
        partner = pTag;
      } else {
        partner = rumor.pubkey;
      }

      const msg: DecryptedMsg = {
        id: rumor.id ?? wrap.id,
        content: rumor.content,
        kind: rumor.kind,
        created_at: rumor.created_at,
        senderPubkey: rumor.pubkey,
        direction: isSent ? 'sent' : 'received',
        subject,
        conversationPartner: partner,
      };

      if (!byPartner.has(partner)) byPartner.set(partner, []);
      byPartner.get(partner)!.push(msg);
    }

    // Flatten all messages (sorted by time) for the messages state
    const allMessages: DecryptedMsg[] = [];
    const newContacts: ConversationContact[] = [];

    byPartner.forEach((msgs, partner) => {
      // Sort each conversation's messages chronologically
      msgs.sort((a, b) => a.created_at - b.created_at);
      allMessages.push(...msgs);
      const lastSeen = msgs[msgs.length - 1].created_at;
      newContacts.push({ pubkey: partner, lastSeen });
    });

    // Global sort for the messages array (used by threadMessages filter)
    allMessages.sort((a, b) => a.created_at - b.created_at);

    setMessages(allMessages);
    setContacts(newContacts.sort((a, b) => b.lastSeen - a.lastSeen));
    setIsDecrypting(false);
    toast({ title: `Decrypted ${allMessages.length} messages across ${newContacts.length} conversations` });
  };

  // Show only messages that belong to the active conversation.
  // Every message now carries its conversationPartner (the other party),
  // so we can filter precisely — no cross-conversation leakage.
  const threadMessages = activeRecipient
    ? messages
        .filter(m => m.conversationPartner === activeRecipient)
        .sort((a, b) => a.created_at - b.created_at)
    : [];

  const handleSend = async () => {
    if (!user || !activeRecipient || !messageInput.trim()) return;
    setIsSending(true);

    try {
      const signerNip44 = user.signer?.nip44;
      const privBytes = !signerNip44 ? getPrivKeyBytes() : null;

      if (!signerNip44 && !privBytes) {
        toast({ title: 'Cannot send', description: 'No NIP-44 capable signer and no private key. Enter your nsec below.', variant: 'destructive' });
        setShowKeyInput(true);
        setIsSending(false);
        return;
      }

      // Build rumor
      const senderPubkey = user.pubkey;
      const tags: string[][] = [['p', activeRecipient, '']];
      if (subjectInput.trim()) tags.push(['subject', subjectInput.trim()]);

      const rumor: Omit<NostrEvent, 'sig'> = {
        id: '', pubkey: senderPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 14, tags, content: messageInput.trim(),
      };
      (rumor as NostrEvent).id = getEventHash(rumor as NostrEvent);

      // Build gift wraps
      let wrapForRecipient: NostrEvent, wrapForSelf: NostrEvent;
      if (signerNip44) {
        const signerWithNip44 = user.signer as Parameters<typeof buildGiftWrapViaSigner>[1];
        [wrapForRecipient, wrapForSelf] = await Promise.all([
          buildGiftWrapViaSigner(rumor, signerWithNip44, activeRecipient),
          buildGiftWrapViaSigner(rumor, signerWithNip44, senderPubkey),
        ]);
      } else {
        [wrapForRecipient, wrapForSelf] = await Promise.all([
          buildGiftWrapViaKey(rumor, privBytes!, activeRecipient),
          buildGiftWrapViaKey(rumor, privBytes!, senderPubkey),
        ]);
      }

      await Promise.all([
        nostr.event(wrapForRecipient, { signal: AbortSignal.timeout(8000) }),
        nostr.event(wrapForSelf, { signal: AbortSignal.timeout(8000) }),
      ]);

      // Add sent message optimistically with conversationPartner set to the recipient
      setMessages(prev => [...prev, {
        id: (rumor as NostrEvent).id, content: rumor.content, kind: rumor.kind,
        created_at: rumor.created_at, senderPubkey, direction: 'sent',
        subject: subjectInput.trim() || undefined,
        conversationPartner: activeRecipient,
      }].sort((a, b) => a.created_at - b.created_at));
      // Ensure contact exists for the recipient
      setContacts(prev => {
        const exists = prev.some(c => c.pubkey === activeRecipient);
        if (exists) return prev.map(c => c.pubkey === activeRecipient ? { ...c, lastSeen: rumor.created_at } : c);
        return [{ pubkey: activeRecipient, lastSeen: rumor.created_at }, ...prev];
      });

      setMessageInput('');
      setSubjectInput('');
      queryClient.invalidateQueries({ queryKey: ['nip17-wraps'] });
      toast({ title: 'Sent privately!' });
    } catch (err) {
      toast({ title: 'Send failed', description: (err as Error).message, variant: 'destructive' });
    }
    setIsSending(false);
  };

  const handleStartConversation = () => {
    const pk = decodePubkey(recipientInput);
    if (!pk) { toast({ title: 'Invalid pubkey', variant: 'destructive' }); return; }
    setActiveRecipient(pk);
    if (!contacts.find(c => c.pubkey === pk)) setContacts(prev => [{ pubkey: pk, lastSeen: 0 }, ...prev]);
  };

  if (!user) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <ShieldCheck className="h-12 w-12 mx-auto text-primary" />
              <p className="text-xl font-semibold">Private DMs (NIP-17)</p>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                End-to-end encrypted using NIP-44 + NIP-59 gift wraps. Works with browser extensions.
              </p>
              <div className="flex justify-center"><LoginArea className="max-w-xs" /></div>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold">Private DMs</h1>
              <p className="text-xs text-muted-foreground">NIP-17 · NIP-44 · NIP-59 gift wraps</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {extensionSupportsNip44
              ? <Badge className="gap-1 text-xs bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30"><CheckCircle2 className="h-3 w-3" />Extension NIP-44 ready</Badge>
              : <Badge variant="secondary" className="gap-1 text-xs"><AlertCircle className="h-3 w-3" />Manual key needed for decrypt</Badge>
            }
          </div>
        </div>

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Extension signer:</strong> If your extension supports NIP-44 (Alby, nos2x-nip44, etc.), sending and decrypting works automatically. Otherwise enter your nsec below the decrypt button for decryption only.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[calc(100vh-18rem)]">

          {/* Sidebar */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-2 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />Conversations
                </span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>

            <div className="px-3 pb-2 space-y-2 shrink-0">
              <div className="flex gap-1">
                <Input placeholder="npub or hex…" value={recipientInput}
                  onChange={e => setRecipientInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleStartConversation()}
                  className="text-xs h-8" />
                <Button size="sm" className="h-8 px-2 shrink-0" onClick={handleStartConversation}>
                  <User className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Decrypt button */}
              {wraps && wraps.length > 0 && (
                <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                  onClick={handleDecryptAll} disabled={isDecrypting}>
                  {isDecrypting
                    ? <><Loader2 className="h-3 w-3 animate-spin" />Decrypting…</>
                    : <><Lock className="h-3 w-3" />Decrypt {wraps.length} messages</>}
                </Button>
              )}

              {/* Manual key fallback */}
              {showKeyInput && (
                <div className="space-y-1 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <Key className="h-3 w-3" />nsec / hex key (decrypt only)
                  </p>
                  <Input type="password" placeholder="nsec1… or 64-char hex"
                    value={manualKey} onChange={e => setManualKey(e.target.value)}
                    className="text-xs h-7 font-mono" />
                  <Button size="sm" className="w-full h-7 text-xs"
                    onClick={() => { setShowKeyInput(false); handleDecryptAll(); }}>
                    <CheckCircle2 className="h-3 w-3 mr-1" />Apply & Decrypt
                  </Button>
                  <p className="text-[10px] text-muted-foreground">Key stays in memory only — not saved anywhere.</p>
                </div>
              )}

              {!showKeyInput && !extensionSupportsNip44 && (
                <Button size="sm" variant="ghost" className="w-full h-6 text-[10px] gap-1"
                  onClick={() => setShowKeyInput(true)}>
                  <Key className="h-3 w-3" />Enter nsec for decryption
                </Button>
              )}
            </div>

            <Separator />

            <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
              {loadingWraps ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-2">
                    <Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 flex-1" />
                  </div>
                ))
              ) : contacts.length === 0 ? (
                <div className="py-8 text-center">
                  <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">No conversations.<br />Enter a pubkey or decrypt messages.</p>
                </div>
              ) : (
                contacts.map(c => (
                  <ContactRow key={c.pubkey} pubkey={c.pubkey}
                    isActive={activeRecipient === c.pubkey}
                    onClick={() => setActiveRecipient(c.pubkey)} />
                ))
              )}
            </div>
          </Card>

          {/* Chat area */}
          <Card className="flex flex-col overflow-hidden">
            {!activeRecipient ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground" />
                  <p className="font-medium">Select a conversation</p>
                  <p className="text-sm text-muted-foreground max-w-xs">Or enter an npub to start a new private conversation</p>
                </div>
              </div>
            ) : (
              <>
                <RecipientHeader pubkey={activeRecipient} onBack={() => setActiveRecipient(null)} />
                <Separator />
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {threadMessages.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-2 py-8">
                        <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {messages.length > 0 ? 'No messages with this contact' : 'Decrypt messages or send your first message'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    threadMessages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
                  )}
                  <div ref={endRef} />
                </div>
                <Separator />
                <div className="p-4 space-y-2">
                  <Input placeholder="Subject (optional)…" value={subjectInput}
                    onChange={e => setSubjectInput(e.target.value)} className="h-8 text-sm" />
                  <div className="flex gap-2">
                    <Textarea placeholder="Write a private message… (Ctrl+Enter to send)"
                      value={messageInput} onChange={e => setMessageInput(e.target.value)}
                      className="min-h-[100px] resize-none text-sm flex-1"
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend(); }} />
                    <Button className="h-auto self-stretch px-4" onClick={handleSend}
                      disabled={isSending || !messageInput.trim()}>
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {extensionSupportsNip44 ? 'Encrypting via extension NIP-44 — no key exposure' : 'Using manual key for encryption'}
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Feature info */}
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Info className="h-4 w-4" />NIP-17 Privacy + Extension Support
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
              {[
                ['🔌', 'Extension NIP-44', 'Alby / nos2x with NIP-44 support — no key needed'],
                ['🔒', 'No metadata leak', 'Relay sees only gift wrap p-tag, not sender or content'],
                ['🎁', 'NIP-59 gift wraps', 'Ephemeral signing key per message'],
                ['🕐', 'Random timestamps', 'Up to 2 days past to prevent timing correlation'],
                ['📨', 'Self-copy wrap', 'Sent messages readable by you'],
                ['🗑️', 'Deniable rumours', 'Unsigned inner events cannot be attributed'],
              ].map(([icon, title, desc]) => (
                <div key={String(title)} className="flex gap-2">
                  <span>{icon}</span>
                  <div><span className="font-medium text-foreground">{title}</span> — {desc}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
