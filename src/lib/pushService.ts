/**
 * PushService — MIP-05 Privacy-Preserving Push Notifications
 *
 * Implements the three-event gossip protocol described in MIP-05:
 *   Kind 447  Encrypted device token publication
 *   Kind 448  Token synchronisation request
 *   Kind 449  Token synchronisation response
 *
 * Every push payload is wrapped in NIP-59 gift wrap architecture:
 *   Rumor  (kind 447/448/449, unsigned)
 *   Seal   (kind 13, NIP-44 encrypted to recipient, signed by real sender)
 *   Wrap   (kind 1059, NIP-44 encrypted with ephemeral key, p-tag = recipient)
 *
 * Privacy guarantees:
 *  - Device tokens encrypted with ECDH + HKDF-SHA256 + ChaCha20-Poly1305
 *    via the NIP-44 signer interface (Web Crypto where available).
 *  - Each gift wrap is signed by a fresh one-time keypair so network
 *    observers cannot build a social graph from notification traffic.
 *  - Timestamps are randomised (±2 days) on both seal and wrap layers.
 *
 * NOTE: Full ChaCha20-Poly1305 and HKDF are provided by the NIP-44 layer
 *       already present in the user's signer. We do NOT expose raw keys.
 *       All encryption calls go through `signer.nip44.encrypt()`.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DeviceToken {
  /** Platform identifier: "apns" | "fcm" | "web-push" */
  platform: string;
  /** The raw device token string (opaque to the push server once encrypted) */
  token: string;
  /** Optional human-readable label */
  label?: string;
}

export interface PushSyncRequest {
  /** Requester's pubkey (hex) */
  requesterPubkey: string;
  /** Unix timestamp of request */
  timestamp: number;
}

export interface PushSyncResponse {
  /** Responding member's pubkey (hex) */
  responderPubkey: string;
  /** The encrypted device tokens they are sharing */
  encryptedTokens: string;
}

interface Nip44Signer {
  encrypt(recipientPubkey: string, plaintext: string): Promise<string>;
  decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
}

interface MinimalSigner {
  pubkey?: string;
  signEvent(e: UnsignedEvent): Promise<SignedEvent>;
  nip44?: Nip44Signer;
}

interface UnsignedEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

interface SignedEvent extends UnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

// ─── Timestamp jitter (NIP-59 recommendation) ─────────────────────────────

/** Returns a timestamp randomly offset by up to `maxOffsetSec` seconds in the past */
function jitteredTimestamp(maxOffsetSec = 172800): number {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * maxOffsetSec);
}

// ─── Ephemeral keypair factory ─────────────────────────────────────────────

function ephemeralKeypair(): { secretKey: Uint8Array; pubkey: string } {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  return { secretKey, pubkey };
}

// ─── NIP-59 Gift Wrap builder ──────────────────────────────────────────────

/**
 * Wraps `rumor` into a NIP-59 gift wrap addressed to `recipientPubkey`.
 *
 * Layers:
 *   1. Rumor  — the original unsigned event (no sig)
 *   2. Seal   — kind 13, encrypts rumor to recipient, signed by sender
 *   3. Wrap   — kind 1059, encrypts seal with ephemeral key, p-tag → recipient
 *
 * Returns the outer gift-wrap event ready to publish.
 */
export async function buildGiftWrap(
  senderSigner: MinimalSigner,
  recipientPubkey: string,
  rumor: UnsignedEvent
): Promise<SignedEvent> {
  if (!senderSigner.nip44) {
    throw new Error('Signer does not support NIP-44 encryption (required for NIP-59 gift wrap)');
  }

  // ── Step 1: Seal (kind 13) ────────────────────────────────────────────
  // Encrypt the rumor JSON to the recipient using the sender's NIP-44
  const rumorJson = JSON.stringify(rumor);
  const sealContent = await senderSigner.nip44.encrypt(recipientPubkey, rumorJson);

  const sealUnsigned: UnsignedEvent = {
    kind: 13,
    content: sealContent,
    tags: [], // MUST be empty per NIP-59
    created_at: jitteredTimestamp(),
  };

  const seal = await senderSigner.signEvent(sealUnsigned);

  // ── Step 2: Gift Wrap (kind 1059) — ephemeral key ─────────────────────
  const ephem = ephemeralKeypair();

  // We need a temporary signer backed by the ephemeral secret key.
  // Since we can't easily inject a signer, we perform the NIP-44 encryption
  // manually using the Web Crypto API via the nostr-tools nip44 module.
  // For browser compatibility we use the approach below:
  const ephemSigner = await createEphemeralSigner(ephem.secretKey, ephem.pubkey);

  const sealJson = JSON.stringify(seal);
  const wrapContent = await ephemSigner.nip44.encrypt(recipientPubkey, sealJson);

  const wrapUnsigned: UnsignedEvent = {
    kind: 1059,
    content: wrapContent,
    tags: [['p', recipientPubkey]],
    created_at: jitteredTimestamp(),
  };

  return ephemSigner.signEvent(wrapUnsigned);
}

// ─── Ephemeral signer (minimal) ───────────────────────────────────────────

/**
 * Builds a minimal signer from a raw secp256k1 secret key bytes.
 * Uses nostr-tools for signing and NIP-44 for encryption.
 */
async function createEphemeralSigner(
  secretKey: Uint8Array,
  pubkey: string
): Promise<MinimalSigner & { nip44: Nip44Signer }> {
  // Import lazily to keep initial bundle lean
  const { finalizeEvent, nip44: nip44Tools } = await import('nostr-tools');

  return {
    pubkey,
    async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
      const template = { ...event, pubkey };
      return finalizeEvent(template, secretKey) as SignedEvent;
    },
    nip44: {
      async encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
        const conversationKey = nip44Tools.getConversationKey(secretKey, recipientPubkey);
        return nip44Tools.encrypt(plaintext, conversationKey);
      },
      async decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
        const conversationKey = nip44Tools.getConversationKey(secretKey, senderPubkey);
        return nip44Tools.decrypt(ciphertext, conversationKey);
      },
    },
  };
}

// ─── Kind 447: Publish Encrypted Device Token ─────────────────────────────

/**
 * Publishes a Kind-447 event advertising your encrypted device token.
 *
 * The token is NIP-44 encrypted to each recipient's pubkey before publishing
 * so the relay/push server never sees the raw token.
 *
 * @param signer       The logged-in user's signer
 * @param token        The device push token to encrypt and publish
 * @param recipients   The pubkeys of group members who should receive your token
 */
export async function publishDeviceToken(
  signer: MinimalSigner,
  token: DeviceToken,
  recipients: string[]
): Promise<SignedEvent[]> {
  if (!signer.nip44) {
    throw new Error('NIP-44 required to publish encrypted device tokens');
  }

  const results: SignedEvent[] = [];

  for (const recipientPubkey of recipients) {
    const tokenJson = JSON.stringify(token);
    const encryptedToken = await signer.nip44.encrypt(recipientPubkey, tokenJson);

    // Rumor for the device token publication
    const rumor: UnsignedEvent = {
      kind: 447,
      content: encryptedToken,
      tags: [
        ['p', recipientPubkey],
        ['alt', 'Encrypted push device token (MIP-05 kind 447)'],
      ],
      created_at: jitteredTimestamp(),
    };

    const wrap = await buildGiftWrap(signer, recipientPubkey, rumor);
    results.push(wrap);
  }

  return results;
}

// ─── Kind 448: Token Sync Request ─────────────────────────────────────────

/**
 * Publishes a Kind-448 sync request, asking group members to share
 * their device tokens with you (so you can send them push notifications).
 *
 * Each request is gift-wrapped individually to prevent metadata leakage.
 */
export async function publishSyncRequest(
  signer: MinimalSigner,
  recipients: string[]
): Promise<SignedEvent[]> {
  if (!signer.pubkey) throw new Error('Signer must expose pubkey');

  const results: SignedEvent[] = [];

  const req: PushSyncRequest = {
    requesterPubkey: signer.pubkey,
    timestamp: Math.floor(Date.now() / 1000),
  };

  for (const recipientPubkey of recipients) {
    const rumor: UnsignedEvent = {
      kind: 448,
      content: JSON.stringify(req),
      tags: [
        ['p', recipientPubkey],
        ['alt', 'Push token sync request (MIP-05 kind 448)'],
      ],
      created_at: jitteredTimestamp(),
    };

    const wrap = await buildGiftWrap(signer, recipientPubkey, rumor);
    results.push(wrap);
  }

  return results;
}

// ─── Kind 449: Token Sync Response ────────────────────────────────────────

/**
 * Responds to a Kind-448 sync request with your device token, encrypted
 * to the requester's pubkey and wrapped in a NIP-59 gift wrap.
 */
export async function publishSyncResponse(
  signer: MinimalSigner,
  requesterPubkey: string,
  token: DeviceToken
): Promise<SignedEvent> {
  if (!signer.nip44) throw new Error('NIP-44 required');
  if (!signer.pubkey) throw new Error('Signer must expose pubkey');

  const tokenJson = JSON.stringify(token);
  const encryptedTokens = await signer.nip44.encrypt(requesterPubkey, tokenJson);

  const resp: PushSyncResponse = {
    responderPubkey: signer.pubkey,
    encryptedTokens,
  };

  const rumor: UnsignedEvent = {
    kind: 449,
    content: JSON.stringify(resp),
    tags: [
      ['p', requesterPubkey],
      ['alt', 'Push token sync response (MIP-05 kind 449)'],
    ],
    created_at: jitteredTimestamp(),
  };

  return buildGiftWrap(signer, requesterPubkey, rumor);
}

// ─── Decrypt incoming gift wrap ───────────────────────────────────────────

/**
 * Decrypts a Kind-1059 gift wrap that was addressed to `signer`.
 *
 * Returns the inner rumor event (the actual payload) or null on failure.
 */
export async function decryptGiftWrap(
  signer: MinimalSigner,
  wrapEvent: SignedEvent
): Promise<UnsignedEvent | null> {
  if (!signer.nip44) return null;

  try {
    // Layer 1: Decrypt the wrap (signed by ephemeral key) to get the seal
    const sealJson = await signer.nip44.decrypt(wrapEvent.pubkey, wrapEvent.content);
    const seal = JSON.parse(sealJson) as SignedEvent;

    // Layer 2: Decrypt the seal (signed by real sender) to get the rumor
    const rumorJson = await signer.nip44.decrypt(seal.pubkey, seal.content);
    const rumor = JSON.parse(rumorJson) as UnsignedEvent;

    return rumor;
  } catch {
    return null;
  }
}

// ─── Utility: npub encoding helper ────────────────────────────────────────

export function encodeNpub(pubkey: string): string {
  try { return nip19.npubEncode(pubkey); } catch { return pubkey; }
}
