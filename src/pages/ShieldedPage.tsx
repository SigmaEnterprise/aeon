import { useState, useRef, useCallback, useEffect } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { nip19, nip44, generateSecretKey, getPublicKey, finalizeEvent, getEventHash } from 'nostr-tools';
import { AppLayout } from '@/components/AppLayout';
import { LoginArea } from '@/components/auth/LoginArea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { genUserName } from '@/lib/genUserName';
import {
  Shield, Send, Lock, Loader2, Info, ArrowLeft,
  MessageSquare, User, CheckCircle2, Key, RefreshCw, ShieldCheck
} from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

// ─── helpers ────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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
    const dec = nip19.decode(t);
    if (dec.type === 'npub') return dec.data as string;
    if (dec.type === 'nprofile') return (dec.data as { pubkey: string }).pubkey;
  } catch { /* ignore */ }
  return null;
}
const randomNow = () => Math.round(Date.now() / 1000 - Math.random() * 2 * 24 * 60 * 60);

// ─── NIP-44 encryption via the signer or raw key ────────────────────────────

async function nip44EncryptWith(
  signer: { nip44?: { encrypt: (pk: string, plain: string) => Promise<string> } },
  recipientPubkey: string,
  plaintext: string
): Promise<string> {
  if (signer.nip44) return signer.nip44.encrypt(recipientPubkey, plaintext);
  throw new Error('Signer does not support NIP-44');
}

async function nip44DecryptWith(
  signer: { nip44?: { decrypt: (pk: string, ciphertext: string) => Promise<string> } },
  senderPubkey: string,
  ciphertext: string
): Promise<string> {
  if (signer.nip44) return signer.nip44.decrypt(senderPubkey, ciphertext);
  throw new Error('Signer does not support NIP-44');
}

// ─── Build NIP-59 gift-wrap ──────────────────────────────────────────────────

async function buildGiftWrap(
  rumor: Omit<NostrEvent, 'sig'>,
  senderPrivKeyBytes: Uint8Array,
  recipientPubkey: string
): Promise<NostrEvent> {
  // 1. seal  (kind 13): encrypt rumor to recipient, signed by sender
  const sealContent = nip44.v2.encrypt(
    JSON.stringify(rumor),
    nip44.v2.utils.getConversationKey(bytesToHex(senderPrivKeyBytes), recipientPubkey)
  );
  const sealTemplate = {
    kind: 13,
    content: sealContent,
    created_at: randomNow(),
    tags: [] as string[][],
  };
  const seal = finalizeEvent(sealTemplate, senderPrivKeyBytes);

  // 2. gift wrap (kind 1059): encrypt seal to recipient, signed by ephemeral key
  const ephemeralKey = generateSecretKey();
  const wrapContent = nip44.v2.encrypt(
    JSON.stringify(seal),
    nip44.v2.utils.getConversationKey(bytesToHex(ephemeralKey), recipientPubkey)
  );
  const wrapTemplate = {
    kind: 1059,
    content: wrapContent,
    created_at: randomNow(),
    tags: [['p', recipientPubkey]] as string[][],
  };
  return finalizeEvent(wrapTemplate, ephemeralKey) as NostrEvent;
}

/** Unwrap a kind:1059 gift wrap. Returns the inner rumor or null. */
async function unwrapGiftWrap(
  wrap: NostrEvent,
  recipientPrivKeyBytes: Uint8Array
): Promise<(Omit<NostrEvent, 'sig'> & { sig?: string }) | null> {
  try {
    const recipientPubkey = getPublicKey(recipientPrivKeyBytes);
    const ck1 = nip44.v2.utils.getConversationKey(bytesToHex(recipientPrivKeyBytes), wrap.pubkey);
    const sealJson = nip44.v2.decrypt(wrap.content, ck1);
    const seal: NostrEvent = JSON.parse(sealJson);

    const ck2 = nip44.v2.utils.getConversationKey(bytesToHex(recipientPrivKeyBytes), seal.pubkey);
    const rumorJson = nip44.v2.decrypt(seal.content, ck2);
    const rumor = JSON.parse(rumorJson);
    // verify the seal pubkey matches the rumor pubkey (prevents impersonation)
    if (rumor.pubkey !== seal.pubkey) return null;
    return rumor;
  } catch {
    return null;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface DecryptedMsg {
  id: string;
  content: string;
  kind: number;
  created_at: number;
  senderPubkey: string;
  direction: 'sent' | 'received';
  subject?: string;
}

interface ConversationContact {
  pubkey: string;
  lastSeen: number;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ContactRow({
  pubkey,
  isActive,
  onClick,
}: {
  pubkey: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const author = useAuthor(pubkey);
  const meta = author.data?.metadata;
  const name = meta?.name ?? genUserName(pubkey);
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left
        ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={meta?.picture} />
        <AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
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
        ${isSent
          ? 'bg-primary text-primary-foreground rounded-tr-sm'
          : 'bg-muted rounded-tl-sm'
        }`}
      >
        {msg.subject && (
          <p className="text-xs font-semibold opacity-70 mb-1">📌 {msg.subject}</p>
        )}
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-[10px] mt-1 ${isSent ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
          {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ShieldedPage() {
  useSeoMeta({
    title: 'Private DMs — Aeon',
    description: 'NIP-17 encrypted direct messages with NIP-44 + NIP-59 gift wraps',
  });

  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // NWC / wallet managed by the project's existing hooks – we don't need it here directly
  // but the WalletModal in the sidebar handles it.

  const [recipientInput, setRecipientInput] = useState('');
  const [activeRecipient, setActiveRecipient] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ConversationContact[]>([]);
  const [messages, setMessages] = useState<DecryptedMsg[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [subjectInput, setSubjectInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [privKeyForDecrypt, setPrivKeyForDecrypt] = useState('');
  const [showPrivKeyInput, setShowPrivKeyInput] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch incoming gift wraps (kind 1059) addressed to us
  const { data: wraps, isLoading: loadingWraps, refetch } = useQuery<NostrEvent[]>({
    queryKey: ['nip17-wraps', user?.pubkey],
    queryFn: async () => {
      if (!user) return [];
      return nostr.query(
        [{ kinds: [1059], '#p': [user.pubkey], limit: 200 }],
        { signal: AbortSignal.timeout(10000) }
      );
    },
    enabled: !!user,
    staleTime: 30000,
  });

  // Helper: get privkey bytes – either from signer or from manual input
  const getPrivKeyBytes = useCallback(async (): Promise<Uint8Array | null> => {
    // Prefer extension / nsec signer's raw key if it exposes one
    // Nostrify NUser has a getPrivateKey helper for nsec logins
    // We'll try to get it from the login store
    if (privKeyForDecrypt.trim()) {
      const hex = privKeyForDecrypt.trim().startsWith('nsec')
        ? (() => {
            try {
              const d = nip19.decode(privKeyForDecrypt.trim());
              return d.type === 'nsec' ? bytesToHex(d.data as Uint8Array) : null;
            } catch { return null; }
          })()
        : (/^[0-9a-fA-F]{64}$/.test(privKeyForDecrypt.trim()) ? privKeyForDecrypt.trim() : null);
      if (hex) return hexToBytes(hex);
    }
    return null;
  }, [privKeyForDecrypt]);

  // Decrypt all wrapped messages
  const handleDecryptAll = async () => {
    if (!wraps || wraps.length === 0 || !user) return;
    const privBytes = await getPrivKeyBytes();
    if (!privBytes) {
      setShowPrivKeyInput(true);
      toast({ title: 'Enter your private key to decrypt', description: 'NIP-17 requires your private key for decryption.' });
      return;
    }
    setIsDecrypting(true);
    const decrypted: DecryptedMsg[] = [];
    const newContacts = new Map<string, number>();

    for (const wrap of wraps) {
      const rumor = await unwrapGiftWrap(wrap, privBytes);
      if (!rumor) continue;
      if (rumor.kind !== 14 && rumor.kind !== 15) continue;
      const subject = rumor.tags?.find(t => t[0] === 'subject')?.[1];
      decrypted.push({
        id: rumor.id ?? wrap.id,
        content: rumor.content,
        kind: rumor.kind,
        created_at: rumor.created_at,
        senderPubkey: rumor.pubkey,
        direction: rumor.pubkey === user.pubkey ? 'sent' : 'received',
        subject,
      });
      newContacts.set(rumor.pubkey, Math.max(newContacts.get(rumor.pubkey) ?? 0, rumor.created_at));
    }

    setMessages(decrypted.sort((a, b) => a.created_at - b.created_at));
    const contactArr: ConversationContact[] = Array.from(newContacts.entries()).map(([pubkey, lastSeen]) => ({ pubkey, lastSeen }));
    setContacts(contactArr.sort((a, b) => b.lastSeen - a.lastSeen));
    setIsDecrypting(false);
    toast({ title: `Decrypted ${decrypted.length} messages` });
  };

  // Filter messages for active conversation
  const conversationMessages = activeRecipient
    ? messages.filter(m =>
        m.senderPubkey === activeRecipient ||
        (m.direction === 'sent' && messages.some(x => x.senderPubkey === activeRecipient && x.direction === 'received'))
      )
    : messages;

  // Truly filter: show only messages between me and activeRecipient
  const threadMessages = activeRecipient
    ? messages.filter(m =>
        m.senderPubkey === activeRecipient ||
        m.direction === 'sent'
      )
    : [];

  // Send a NIP-17 message
  const handleSend = async () => {
    if (!user || !activeRecipient || !messageInput.trim()) return;
    setIsSending(true);

    try {
      const privBytes = await getPrivKeyBytes();
      if (!privBytes) {
        toast({ title: 'Private key required to send NIP-17 messages', variant: 'destructive' });
        setShowPrivKeyInput(true);
        setIsSending(false);
        return;
      }

      const senderPubkey = getPublicKey(privBytes);
      const recipientRelays = await nostr.query(
        [{ kinds: [10050], authors: [activeRecipient], limit: 1 }],
        { signal: AbortSignal.timeout(5000) }
      ).then(evts => evts[0]?.tags.filter(t => t[0] === 'relay').map(t => t[1]) ?? []);

      const tags: string[][] = [['p', activeRecipient, recipientRelays[0] ?? '']];
      if (subjectInput.trim()) tags.push(['subject', subjectInput.trim()]);

      // Build unsigned rumor (kind 14)
      const rumor: Omit<NostrEvent, 'sig'> = {
        id: '',
        pubkey: senderPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 14,
        tags,
        content: messageInput.trim(),
      };
      rumor.id = getEventHash(rumor as NostrEvent);

      // Wrap for recipient
      const wrapForRecipient = await buildGiftWrap(rumor, privBytes, activeRecipient);
      // Wrap for self (so we can read sent messages)
      const wrapForSelf = await buildGiftWrap(rumor, privBytes, senderPubkey);

      const relays = config.relayMetadata.relays.map(r => r.url);

      // Publish wraps
      await Promise.all([
        nostr.event(wrapForRecipient, { signal: AbortSignal.timeout(8000) }),
        nostr.event(wrapForSelf, { signal: AbortSignal.timeout(8000) }),
      ]);

      // Optimistically add to local messages
      setMessages(prev => [...prev, {
        id: rumor.id,
        content: rumor.content,
        kind: rumor.kind,
        created_at: rumor.created_at,
        senderPubkey: senderPubkey,
        direction: 'sent',
        subject: subjectInput.trim() || undefined,
      }].sort((a, b) => a.created_at - b.created_at));

      setMessageInput('');
      setSubjectInput('');
      queryClient.invalidateQueries({ queryKey: ['nip17-wraps'] });
      toast({ title: 'Message sent privately!' });
    } catch (err) {
      toast({ title: 'Send failed', description: (err as Error).message, variant: 'destructive' });
    }
    setIsSending(false);
  };

  const handleStartConversation = () => {
    const pk = decodePubkey(recipientInput);
    if (!pk) {
      toast({ title: 'Invalid pubkey', variant: 'destructive' });
      return;
    }
    setActiveRecipient(pk);
    if (!contacts.find(c => c.pubkey === pk)) {
      setContacts(prev => [{ pubkey: pk, lastSeen: 0 }, ...prev]);
    }
  };

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!user) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <ShieldCheck className="h-12 w-12 mx-auto text-primary" />
              <p className="text-xl font-semibold">Private DMs (NIP-17)</p>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                NIP-17 uses NIP-44 encryption + NIP-59 gift wraps to hide metadata, sender, recipient, and timing.
              </p>
              <div className="flex justify-center">
                <LoginArea className="max-w-xs" />
              </div>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Private DMs</h1>
            <p className="text-xs text-muted-foreground">NIP-17 · NIP-44 encryption · NIP-59 gift wraps</p>
          </div>
        </div>

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Maximum privacy:</strong> Messages are sealed with NIP-44 encryption and gift-wrapped (NIP-59) so relay operators see only that you received <em>something</em> — not who sent it, when, or what it says.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 h-[calc(100vh-22rem)]">
          {/* Sidebar: contacts + new convo */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-2 shrink-0">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />Conversations</span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()} title="Refresh">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </CardTitle>
            </CardHeader>

            <div className="px-3 pb-3 space-y-2 shrink-0">
              <div className="flex gap-1">
                <Input
                  placeholder="npub or hex pubkey…"
                  value={recipientInput}
                  onChange={e => setRecipientInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleStartConversation()}
                  className="text-xs h-8"
                />
                <Button size="sm" className="h-8 px-2 shrink-0" onClick={handleStartConversation}>
                  <User className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Decrypt button */}
              {wraps && wraps.length > 0 && messages.length === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-xs gap-1"
                  onClick={handleDecryptAll}
                  disabled={isDecrypting}
                >
                  {isDecrypting
                    ? <><Loader2 className="h-3 w-3 animate-spin" />Decrypting…</>
                    : <><Lock className="h-3 w-3" />Decrypt {wraps.length} messages</>}
                </Button>
              )}
              {messages.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full h-7 text-xs gap-1"
                  onClick={handleDecryptAll}
                  disabled={isDecrypting}
                >
                  {isDecrypting
                    ? <><Loader2 className="h-3 w-3 animate-spin" />Re-decrypting…</>
                    : <><RefreshCw className="h-3 w-3" />Re-decrypt</>}
                </Button>
              )}
            </div>

            <Separator />

            {/* Private key input for decryption */}
            {showPrivKeyInput && (
              <div className="px-3 py-2 space-y-1 bg-amber-500/10 border-b">
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                  <Key className="h-3 w-3" />Private key needed for decryption
                </p>
                <Input
                  type="password"
                  placeholder="nsec1… or hex"
                  value={privKeyForDecrypt}
                  onChange={e => setPrivKeyForDecrypt(e.target.value)}
                  className="text-xs h-7 font-mono"
                />
                <Button
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => { setShowPrivKeyInput(false); handleDecryptAll(); }}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />Apply
                </Button>
                <p className="text-[10px] text-muted-foreground">Extension signers that don't expose private keys can't decrypt NIP-17 messages natively in this client yet.</p>
              </div>
            )}

            {/* Contact list */}
            <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
              {loadingWraps ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-2">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))
              ) : contacts.length === 0 ? (
                <div className="py-8 text-center">
                  <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">No conversations yet.<br />Enter a pubkey above or decrypt messages.</p>
                </div>
              ) : (
                contacts.map(c => (
                  <ContactRow
                    key={c.pubkey}
                    pubkey={c.pubkey}
                    isActive={activeRecipient === c.pubkey}
                    onClick={() => setActiveRecipient(c.pubkey)}
                  />
                ))
              )}
            </div>
          </Card>

          {/* Chat area */}
          <Card className="flex flex-col overflow-hidden">
            {!activeRecipient ? (
              <CardContent className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground" />
                  <p className="font-medium">Select a conversation</p>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Or enter an npub above to start a new private conversation
                  </p>
                </div>
              </CardContent>
            ) : (
              <>
                {/* Chat header */}
                <RecipientHeader pubkey={activeRecipient} onBack={() => setActiveRecipient(null)} />

                <Separator />

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {threadMessages.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center h-full">
                      <div className="text-center space-y-2 py-8">
                        <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {messages.length > 0
                            ? 'No messages with this contact yet'
                            : 'Decrypt messages to read them, or send your first message below'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    threadMessages.map(msg => (
                      <MessageBubble key={msg.id} msg={msg} />
                    ))
                  )}
                  <div ref={endRef} />
                </div>

                <Separator />

                {/* Compose area */}
                <div className="p-3 space-y-2">
                  <Input
                    placeholder="Subject (optional)…"
                    value={subjectInput}
                    onChange={e => setSubjectInput(e.target.value)}
                    className="h-7 text-xs"
                  />
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Write a private message… (Ctrl+Enter to send)"
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      className="min-h-[60px] resize-none text-sm flex-1"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
                      }}
                    />
                    <Button
                      className="h-auto self-stretch px-3"
                      onClick={handleSend}
                      disabled={isSending || !messageInput.trim()}
                    >
                      {isSending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Messages are sealed with NIP-44 and gift-wrapped (NIP-59) before publishing
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
              <Info className="h-4 w-4" />NIP-17 Privacy Features
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
              {[
                ['🔒', 'No metadata leak', 'Identities, times, and event kinds are all hidden'],
                ['🎁', 'Gift wraps (NIP-59)', 'Each message is wrapped with an ephemeral key'],
                ['🔑', 'NIP-44 encryption', 'XChaCha20-Poly1305 authenticated encryption'],
                ['🕐', 'Randomised timestamps', 'Up to 2 days in the past to prevent correlation'],
                ['📨', 'Per-recipient wraps', 'Separate encrypted envelope for each participant'],
                ['🗑️', 'Deniable messages', 'Unsigned rumours cannot be attributed if leaked'],
              ].map(([icon, title, desc]) => (
                <div key={title as string} className="flex gap-2">
                  <span>{icon}</span>
                  <div>
                    <span className="font-medium text-foreground">{title}</span>
                    <span className="text-muted-foreground"> — {desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
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
        <AvatarImage src={meta?.picture} />
        <AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
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
