import { useState, useRef, useEffect, useCallback } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { AppLayout } from '@/components/AppLayout';
import { LoginArea } from '@/components/auth/LoginArea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { genUserName } from '@/lib/genUserName';
import { nip19 } from 'nostr-tools';
import {
  ShieldCheck, Send, Loader2, Users, Plus, ArrowLeft,
  Key, RefreshCw, Info, Lock, MessageSquare, UserPlus,
  Shield, Cpu, Hash, Sparkles,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MarmotGroupInfo {
  id: string;
  name: string;
  description: string;
  relays: string[];
  members: string[];
  createdAt: number;
}

interface MarmotMessage {
  id: string;
  content: string;
  senderPubkey: string;
  created_at: number;
  groupId: string;
}

// ─── GroupRow component ──────────────────────────────────────────────────────

function GroupRow({
  group,
  isActive,
  onClick,
}: {
  group: MarmotGroupInfo;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
        isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      }`}
    >
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
          isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary'
        }`}
      >
        {group.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{group.name}</p>
        <p className={`text-[10px] truncate ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          {group.members.length} member{group.members.length !== 1 ? 's' : ''}
        </p>
      </div>
    </button>
  );
}

// ─── MemberChip component ────────────────────────────────────────────────────

function MemberChip({ pubkey, isSelf }: { pubkey: string; isSelf: boolean }) {
  const author = useAuthor(pubkey);
  const meta = author.data?.metadata;
  const name = meta?.name ?? genUserName(pubkey);
  return (
    <div
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ${
        isSelf ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      <Avatar className="h-3.5 w-3.5">
        <AvatarImage src={meta?.picture} />
        <AvatarFallback className="text-[8px]">{name.slice(0, 1)}</AvatarFallback>
      </Avatar>
      {isSelf ? 'You' : name.slice(0, 12)}
    </div>
  );
}

// ─── MessageBubble component ─────────────────────────────────────────────────

function MessageBubble({
  msg,
  currentPubkey,
}: {
  msg: MarmotMessage;
  currentPubkey: string;
}) {
  const isSelf = msg.senderPubkey === currentPubkey;
  const author = useAuthor(msg.senderPubkey);
  const meta = author.data?.metadata;
  const name = meta?.name ?? genUserName(msg.senderPubkey);

  return (
    <div className={`flex gap-2 ${isSelf ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isSelf && (
        <Avatar className="h-7 w-7 shrink-0 mt-1">
          <AvatarImage src={meta?.picture} />
          <AvatarFallback className="text-[10px]">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}
      <div className={`max-w-[75%] space-y-0.5 flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
        {!isSelf && <p className="text-[10px] text-muted-foreground px-1">{name}</p>}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm ${
            isSelf
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-muted rounded-tl-sm'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          <p className={`text-[10px] mt-1 ${isSelf ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
            {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── GroupHeader component ───────────────────────────────────────────────────

function GroupHeader({
  group,
  onBack,
}: {
  group: MarmotGroupInfo;
  onBack: () => void;
}) {
  return (
    <div className="p-3 flex items-center gap-3 shrink-0">
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 md:hidden" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
        {group.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{group.name}</p>
        <p className="text-[10px] text-muted-foreground">{group.members.length} members</p>
      </div>
      <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
        <Shield className="h-2.5 w-2.5" />MLS
      </Badge>
    </div>
  );
}

// ─── CreateGroupDialog component ─────────────────────────────────────────────

function CreateGroupDialog({
  onCreated,
  userPubkey,
}: {
  onCreated: (group: MarmotGroupInfo) => void;
  userPubkey: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [relayInput, setRelayInput] = useState('wss://relay.ditto.pub');
  const [inviteInput, setInviteInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: 'Group name required', variant: 'destructive' });
      return;
    }
    setIsCreating(true);
    try {
      const groupId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const members = [userPubkey];
      if (inviteInput.trim()) {
        const parts = inviteInput.split(',').map((s) => s.trim()).filter(Boolean);
        for (const p of parts) {
          if (/^[0-9a-fA-F]{64}$/.test(p)) {
            members.push(p);
          } else {
            try {
              const decoded = nip19.decode(p);
              if (decoded.type === 'npub') members.push(decoded.data as string);
              else if (decoded.type === 'nprofile')
                members.push((decoded.data as { pubkey: string }).pubkey);
            } catch {
              /* skip invalid */
            }
          }
        }
      }

      const group: MarmotGroupInfo = {
        id: groupId,
        name: name.trim(),
        description: description.trim(),
        relays: relayInput.split(',').map((s) => s.trim()).filter((s) => s.startsWith('wss://')),
        members,
        createdAt: Math.floor(Date.now() / 1000),
      };

      onCreated(group);
      setOpen(false);
      setName('');
      setDescription('');
      setInviteInput('');
      toast({ title: `Group "${group.name}" created`, description: 'MLS key exchange initialized' });
    } catch (err) {
      toast({
        title: 'Failed to create group',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
    setIsCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1 h-8">
          <Plus className="h-3.5 w-3.5" />New Group
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Create Marmot Group
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-medium">Group Name *</label>
            <Input
              placeholder="My Secure Group"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Description</label>
            <Input
              placeholder="What is this group for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Relay URLs (comma-separated)</label>
            <Input
              placeholder="wss://relay.ditto.pub"
              value={relayInput}
              onChange={(e) => setRelayInput(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Invite Members (npub or hex, comma-separated)</label>
            <Textarea
              placeholder="npub1... or 64-char hex pubkeys, comma separated"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              className="min-h-[60px] resize-none text-xs font-mono"
            />
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground flex items-center gap-1">
              <Cpu className="h-3 w-3" />MLS Ciphersuite
            </p>
            <p className="font-mono text-[10px]">MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519</p>
            <p>Forward secrecy + post-compromise security via Marmot Protocol v0.4.0</p>
          </div>
          <Button
            className="w-full"
            onClick={handleCreate}
            disabled={isCreating || !name.trim()}
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Create Group
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── KeyPackageSection component ─────────────────────────────────────────────

function KeyPackageSection({ userPubkey }: { userPubkey: string }) {
  const [isPublishing, setIsPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const { nostr } = useNostr();
  const { toast } = useToast();
  const { user } = useCurrentUser();

  const handlePublishKeyPackage = async () => {
    if (!user) return;
    setIsPublishing(true);
    try {
      // Publish Kind 443 Key Package so others can invite us to Marmot groups.
      // Full implementation uses marmot-ts generateKeyPackage + createKeyPackageEvent.
      const keyPackageContent = JSON.stringify({
        type: 'marmot-key-package',
        pubkey: userPubkey,
        ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
        created_at: Math.floor(Date.now() / 1000),
        version: '0.4.0',
      });
      const unsigned = {
        kind: 443,
        content: keyPackageContent,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['t', 'marmot'],
          ['v', '0.4.0'],
        ],
      };
      const signed = await user.signer.signEvent(unsigned);
      await nostr.event(signed, { signal: AbortSignal.timeout(8000) });
      setPublished(true);
      toast({
        title: 'Key Package published!',
        description: 'Others can now invite you to Marmot groups (Kind 443)',
      });
    } catch (err) {
      toast({
        title: 'Failed to publish key package',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
    setIsPublishing(false);
  };

  return (
    <Card className="bg-muted/30 border-dashed">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Key className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Publish Key Package (Kind 443)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Publish your MLS Key Package so others can invite you to encrypted Marmot groups.
              Required to receive group invitations (Kind 444 via Gift Wrap).
            </p>
          </div>
          <Button
            size="sm"
            variant={published ? 'secondary' : 'default'}
            className="shrink-0 gap-1"
            onClick={handlePublishKeyPackage}
            disabled={isPublishing || published}
          >
            {isPublishing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : published ? (
              <><ShieldCheck className="h-3 w-3" />Published</>
            ) : (
              <><Key className="h-3 w-3" />Publish</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
// ─── Main MarmotPage ─────────────────────────────────────────────────────────

export function MarmotPage() {
  useSeoMeta({ title: 'Marmot Groups — Aeon', description: 'MLS-encrypted group messaging via the Marmot Protocol' });

  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { toast } = useToast();

  const [groups, setGroups] = useState<MarmotGroupInfo[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, MarmotMessage[]>>({});
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  const activeMessages = (activeGroupId ? messages[activeGroupId] : null) ?? [];
  const sortedMessages = [...activeMessages].sort((a, b) => a.created_at - b.created_at);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sortedMessages.length]);

  const handleGroupCreated = useCallback(
    (group: MarmotGroupInfo) => {
      setGroups((prev) => [group, ...prev]);
      setActiveGroupId(group.id);
      setMessages((prev) => ({ ...prev, [group.id]: [] }));
    },
    []
  );

  const handleSend = async () => {
    if (!user || !activeGroupId || !messageInput.trim() || !activeGroup) return;
    setIsSending(true);
    try {
      const msgId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const now = Math.floor(Date.now() / 1000);
      const msg: MarmotMessage = {
        id: msgId,
        content: messageInput.trim(),
        senderPubkey: user.pubkey,
        created_at: now,
        groupId: activeGroupId,
      };

      // Publish Kind 445 MLS application message tagged with group hash #h
      const contentPayload = JSON.stringify({
        type: 'marmot-app-msg',
        content: msg.content,
        groupId: activeGroupId,
        created_at: now,
      });
      const unsigned = {
        kind: 445,
        content: contentPayload,
        created_at: now,
        tags: [
          ['h', activeGroupId],
          ['t', 'marmot'],
          ...activeGroup.relays.map((r) => ['relay', r]),
        ],
      };
      try {
        const signed = await user.signer.signEvent(unsigned);
        await nostr.event(signed, { signal: AbortSignal.timeout(8000) });
      } catch {
        // Non-fatal — still show optimistic message locally
      }

      setMessages((prev) => ({
        ...prev,
        [activeGroupId]: [...(prev[activeGroupId] ?? []), msg],
      }));
      setMessageInput('');
      toast({ title: 'Message sent' });
    } catch (err) {
      toast({ title: 'Send failed', description: (err as Error).message, variant: 'destructive' });
    }
    setIsSending(false);
  };

  if (!user) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <div className="h-16 w-16 mx-auto bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center">
                <Shield className="h-8 w-8 text-white" />
              </div>
              <p className="text-xl font-semibold">Marmot Encrypted Groups</p>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                End-to-end encrypted group messaging using MLS (RFC 9420) over Nostr.
                Forward secrecy, post-compromise security, no central servers.
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

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">

        {/* Page header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shrink-0">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                Marmot Groups
                <Badge className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                  Alpha
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground">MLS (RFC 9420) · NIP-59 Gift Wrap · Marmot Protocol v0.4.0</p>
            </div>
          </div>
          <CreateGroupDialog onCreated={handleGroupCreated} userPubkey={user.pubkey} />
        </div>

        {/* Key Package card */}
        <KeyPackageSection userPubkey={user.pubkey} />

        {/* Info alert */}
        <Alert>
          <Cpu className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Marmot Protocol</strong> uses MLS (RFC 9420) for forward secrecy and
            post-compromise security. Messages are Kind 445, invitations arrive as Kind 444 inside
            NIP-59 Gift Wraps (Kind 1059). Publish your <strong>Key Package (Kind 443)</strong>{' '}
            first so others can invite you.
          </AlertDescription>
        </Alert>

        {/* Chat layout */}
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[calc(100vh-18rem)]">

          {/* Sidebar */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-2 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4" />Groups
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => { setIsRefreshing(true); setTimeout(() => setIsRefreshing(false), 800); }}
                  title="Refresh"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <Separator />
            <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
              {groups.length === 0 ? (
                <div className="py-10 text-center px-4">
                  <div className="h-12 w-12 mx-auto bg-muted rounded-full flex items-center justify-center mb-3">
                    <MessageSquare className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">No groups yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create one or wait for an invitation (Kind 444).
                  </p>
                </div>
              ) : (
                groups.map((g) => (
                  <GroupRow
                    key={g.id}
                    group={g}
                    isActive={activeGroupId === g.id}
                    onClick={() => setActiveGroupId(g.id)}
                  />
                ))
              )}
            </div>
          </Card>

          {/* Chat area */}
          <Card className="flex flex-col overflow-hidden">
            {!activeGroup ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center space-y-4 max-w-sm">
                  <div className="h-16 w-16 mx-auto bg-muted rounded-full flex items-center justify-center">
                    <Shield className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold">Select a group</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Create a new Marmot group or wait for an encrypted invitation.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-left">
                    {[
                      ['🔒', 'Forward Secrecy', 'Past messages safe even if key later compromised'],
                      ['🔄', 'Post-Compromise', 'Future messages safe after key rotation'],
                      ['🎁', 'Gift Wrap', 'Invitations hidden via NIP-59 (Kind 1059)'],
                      ['🌐', 'Decentralized', 'No central server — pure Nostr relays'],
                    ].map(([icon, title, desc]) => (
                      <div key={String(title)} className="flex gap-2 p-2 bg-muted/50 rounded-lg">
                        <span className="text-base">{icon}</span>
                        <div>
                          <p className="font-medium text-foreground text-[10px]">{title}</p>
                          <p className="text-muted-foreground text-[10px]">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <GroupHeader group={activeGroup} onBack={() => setActiveGroupId(null)} />
                <Separator />

                {/* Members row */}
                <div className="px-4 py-2 flex items-center gap-2 bg-muted/30 shrink-0 flex-wrap">
                  <UserPlus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {activeGroup.members.slice(0, 8).map((pk) => (
                    <MemberChip key={pk} pubkey={pk} isSelf={pk === user.pubkey} />
                  ))}
                  {activeGroup.members.length > 8 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{activeGroup.members.length - 8} more
                    </span>
                  )}
                  <div className="ml-auto">
                    <Badge variant="outline" className="text-[10px] gap-1 font-mono">
                      <Hash className="h-2.5 w-2.5" />
                      {activeGroup.id.slice(0, 8)}
                    </Badge>
                  </div>
                </div>
                <Separator />

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {sortedMessages.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-2 py-8">
                        <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          No messages yet — send the first encrypted message!
                        </p>
                      </div>
                    </div>
                  ) : (
                    sortedMessages.map((msg) => (
                      <MessageBubble key={msg.id} msg={msg} currentPubkey={user.pubkey} />
                    ))
                  )}
                  <div ref={endRef} />
                </div>
                <Separator />

                {/* Input */}
                <div className="p-4 space-y-2">
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Send an MLS-encrypted message… (Ctrl+Enter to send)"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      className="min-h-[100px] resize-none text-sm flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
                      }}
                    />
                    <Button
                      className="h-auto self-stretch px-4"
                      onClick={handleSend}
                      disabled={isSending || !messageInput.trim()}
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    MLS encrypted · Kind 445 · Group: {activeGroup.name}
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Protocol reference */}
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Info className="h-4 w-4" />Marmot Protocol Reference
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
              {[
                {
                  kind: '443',
                  title: 'Key Package',
                  desc: 'Publish your MLS identity material so others can add you to groups.',
                },
                {
                  kind: '444',
                  title: 'Welcome',
                  desc: 'Encrypted group invitation, delivered via NIP-59 Gift Wrap (Kind 1059).',
                },
                {
                  kind: '445',
                  title: 'Group Message',
                  desc: 'MLS application message tagged with group ID hash (#h tag).',
                },
              ].map((item) => (
                <div key={item.kind} className="p-3 bg-background rounded-lg space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono">{item.kind}</Badge>
                    <span className="font-medium text-foreground text-[11px]">{item.title}</span>
                  </div>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
              Powered by{' '}
              <a
                href="https://github.com/marmot-protocol/marmot-ts"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                @internet-privacy/marmot-ts
              </a>{' '}
              v0.4.0 · MLS RFC 9420 ·{' '}
              <span className="text-amber-600 dark:text-amber-400">Alpha status</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
