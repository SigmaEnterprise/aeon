import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { AppLayout } from '@/components/AppLayout';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  Key, Eye, EyeOff, Copy, Download, RefreshCw, Trash2, Lock, Unlock,
  AlertTriangle, CheckCircle2, Shield
} from 'lucide-react';
// Hex utilities
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// Crypto helpers
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptKey(password: string, hexKey: string): Promise<{ salt: string; iv: string; data: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, hexToBytes(hexKey));
  return {
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    data: bytesToHex(new Uint8Array(encrypted)),
  };
}

async function decryptKey(password: string, salt: string, iv: string, data: string): Promise<string> {
  const key = await deriveKey(password, hexToBytes(salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(iv) },
    key,
    hexToBytes(data)
  );
  return bytesToHex(new Uint8Array(decrypted));
}

type EncryptedKeyData = { salt: string; iv: string; data: string; pubkey: string; npub: string };

const ENCRYPTED_KEY_STORAGE = 'aeon:encrypted-key';

export function KeysPage() {
  useSeoMeta({ title: 'Keys — Aeon', description: 'Manage your Nostr keys' });

  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [showPrivKey, setShowPrivKey] = useState(false);
  const [privKeyInput, setPrivKeyInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Check for stored encrypted key
  const storedEncrypted: EncryptedKeyData | null = (() => {
    try {
      const raw = localStorage.getItem(ENCRYPTED_KEY_STORAGE);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  const normalizePrivKey = (input: string): string | null => {
    const trimmed = input.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'nsec') {
        const data = decoded.data;
        if (data instanceof Uint8Array) return bytesToHex(data);
        return String(data);
      }
    } catch { /* ignore */ }
    return null;
  };

  const handleGenerateKey = () => {
    const privKey = generateSecretKey();
    const privKeyHex = bytesToHex(privKey);
    const pubKey = getPublicKey(privKey);
    const nsec = nip19.nsecEncode(privKey);
    const npub = nip19.npubEncode(pubKey);

    setPrivKeyInput(nsec);
    toast({
      title: 'New key pair generated',
      description: `npub: ${npub.slice(0, 20)}...`,
    });
  };

  const handleSaveEncrypted = async () => {
    const hexKey = normalizePrivKey(privKeyInput);
    if (!hexKey) {
      toast({ title: 'Invalid private key', variant: 'destructive' });
      return;
    }
    if (!passwordInput) {
      toast({ title: 'Password required', variant: 'destructive' });
      return;
    }

    setIsProcessing(true);
    try {
      const privKeyBytes = hexToBytes(hexKey);
      const pubKey = getPublicKey(privKeyBytes);
      const npub = nip19.npubEncode(pubKey);

      const encrypted = await encryptKey(passwordInput, hexKey);
      const toStore: EncryptedKeyData = { ...encrypted, pubkey: pubKey, npub };
      localStorage.setItem(ENCRYPTED_KEY_STORAGE, JSON.stringify(toStore));

      toast({ title: 'Key encrypted and saved!' });
      setPrivKeyInput('');
      setPasswordInput('');
    } catch (err) {
      toast({ title: 'Encryption failed', description: (err as Error).message, variant: 'destructive' });
    }
    setIsProcessing(false);
  };

  const handleLoadEncrypted = async () => {
    if (!storedEncrypted) {
      toast({ title: 'No encrypted key found', variant: 'destructive' });
      return;
    }
    if (!passwordInput) {
      toast({ title: 'Password required', variant: 'destructive' });
      return;
    }

    setIsProcessing(true);
    try {
      const hexKey = await decryptKey(passwordInput, storedEncrypted.salt, storedEncrypted.iv, storedEncrypted.data);
      const nsec = nip19.nsecEncode(hexToBytes(hexKey));
      setPrivKeyInput(nsec);
      toast({ title: 'Key decrypted!', description: 'You can now use it to log in.' });
    } catch {
      toast({ title: 'Decryption failed', description: 'Incorrect password?', variant: 'destructive' });
    }
    setIsProcessing(false);
  };

  const handleExport = async () => {
    const hexKey = normalizePrivKey(privKeyInput);
    if (!hexKey) {
      toast({ title: 'No key to export', variant: 'destructive' });
      return;
    }
    if (!passwordInput) {
      toast({ title: 'Enter a password to encrypt export', variant: 'destructive' });
      return;
    }

    try {
      const privKeyBytes = hexToBytes(hexKey);
      const pubKey = getPublicKey(privKeyBytes);
      const npub = nip19.npubEncode(pubKey);
      const encrypted = await encryptKey(passwordInput, hexKey);
      const exportData = { ...encrypted, pubkey: pubKey, npub };
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nostr-key-backup-${npub.slice(0, 16)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({ title: 'Key exported as encrypted JSON backup' });
    } catch (err) {
      toast({ title: 'Export failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleClearStored = () => {
    localStorage.removeItem(ENCRYPTED_KEY_STORAGE);
    toast({ title: 'Encrypted key cleared from storage' });
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied!` });
  };

  // Derive pubkey from privkey input for display
  let derivedPubkey: string | null = null;
  let derivedNpub: string | null = null;
  let derivedNsec: string | null = null;
  const hexKey = normalizePrivKey(privKeyInput);
  if (hexKey) {
    try {
      const privKeyBytes = hexToBytes(hexKey);
      derivedPubkey = getPublicKey(privKeyBytes);
      derivedNpub = nip19.npubEncode(derivedPubkey);
      derivedNsec = nip19.nsecEncode(privKeyBytes);
    } catch { /* ignore */ }
  }

  const currentUserNpub = user?.pubkey ? nip19.npubEncode(user.pubkey) : null;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Current logged-in user */}
        {user && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Currently Logged In
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">npub (public key)</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted rounded px-2 py-1.5 break-all">{currentUserNpub}</code>
                  <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => handleCopy(currentUserNpub!, 'npub')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">hex pubkey</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted rounded px-2 py-1.5 break-all">{user.pubkey}</code>
                  <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => handleCopy(user.pubkey, 'Hex pubkey')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Login with nostrify */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              Nostr Login
            </CardTitle>
            <CardDescription className="text-xs">
              Log in with an extension, nsec, or create a new account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginArea className="w-full" />
          </CardContent>
        </Card>

        {/* Key management tools */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Key Tools
            </CardTitle>
            <CardDescription className="text-xs">
              Generate, encrypt, and backup your Nostr keys
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Never share your private key (nsec/hex). Anyone with access to your private key controls your identity.
              </AlertDescription>
            </Alert>

            {/* Private key input */}
            <div className="space-y-2">
              <Label className="text-sm">Private Key (nsec or hex)</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showPrivKey ? 'text' : 'password'}
                    placeholder="nsec1... or 64-char hex"
                    value={privKeyInput}
                    onChange={e => setPrivKeyInput(e.target.value)}
                    className="font-mono text-xs pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivKey(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPrivKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button variant="outline" size="icon" onClick={handleGenerateKey} title="Generate new key">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Derived keys display */}
            {derivedNpub && (
              <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">Derived npub:</p>
                    <code className="text-xs break-all">{derivedNpub}</code>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => handleCopy(derivedNpub!, 'npub')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                {derivedNsec && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">nsec:</p>
                      <code className="text-xs break-all">{showPrivKey ? derivedNsec : derivedNsec.replace(/./g, '•')}</code>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => handleCopy(derivedNsec!, 'nsec')}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Password for encryption */}
            <div className="space-y-2">
              <Label className="text-sm">Password (for encrypt/decrypt)</Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter password..."
                  value={passwordInput}
                  onChange={e => setPasswordInput(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleSaveEncrypted}
                disabled={isProcessing || !privKeyInput || !passwordInput}
              >
                <Lock className="h-3.5 w-3.5" />
                Encrypt & Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleLoadEncrypted}
                disabled={isProcessing || !storedEncrypted || !passwordInput}
              >
                <Unlock className="h-3.5 w-3.5" />
                Decrypt Saved
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleExport}
                disabled={!privKeyInput || !passwordInput}
              >
                <Download className="h-3.5 w-3.5" />
                Export Backup
              </Button>
            </div>

            {/* Stored key info */}
            {storedEncrypted && (
              <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div>
                  <p className="text-xs font-medium text-green-700 dark:text-green-400">Encrypted key stored locally</p>
                  <p className="text-xs text-muted-foreground font-mono">{storedEncrypted.npub.slice(0, 24)}…</p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-destructive hover:text-destructive" onClick={handleClearStored}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Help card */}
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground space-y-1">
              <span className="block font-medium text-foreground mb-1">How key management works:</span>
              <span className="block">• <strong>Extension login</strong>: safest — your key never leaves the extension</span>
              <span className="block">• <strong>nsec login</strong>: key stored in browser session memory</span>
              <span className="block">• <strong>Encrypt & Save</strong>: encrypts your key with AES-256-GCM using your password, stored in localStorage</span>
              <span className="block">• <strong>Export Backup</strong>: saves an encrypted JSON backup file</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
