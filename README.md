# Bitchat — Full-Featured Nostr Client

A modern, privacy-focused Nostr client built with React 19, TailwindCSS, shadcn/ui, and Nostrify.

---

## Features

| Feature | Description | Protocol |
|---|---|---|
| **Global Feed** | Real-time public feed with infinite scroll, media rendering, and compose | NIP-01 |
| **Custom Feeds** | Follow specific pubkeys and view their notes | NIP-01 |
| **Private DMs** | End-to-end encrypted direct messages with maximum privacy | **NIP-17, NIP-44, NIP-59** |
| **Profile** | View and edit your profile, browse your own posts | NIP-01, NIP-02 |
| **Directory** | Search profiles by npub, hex pubkey, or name | NIP-01 |
| **Keys** | Generate, encrypt (AES-256-GCM), backup, and restore keys | NIP-19 |
| **Relays** | Manage your NIP-65 relay list with live status indicators | NIP-65 |
| **Media Hosts** | Configure Blossom / NIP-96 upload servers with auto-probing | NIP-96, NIP-98 |
| **Lightning Zaps** | Send zaps via WebLN or Nostr Wallet Connect (NWC) | NIP-57, NWC |
| **Themes** | 15 built-in themes (Dark, Solarized, Terminal, Neon, Dracula, etc.) | — |

---

## Private DMs (NIP-17)

This client implements **NIP-17 Private Direct Messages**, the most privacy-preserving messaging protocol on Nostr. Unlike the legacy NIP-04 scheme, NIP-17 hides **all** metadata.

### How it works

```
You compose a message
    │
    ▼
kind:14 rumor (unsigned, no sig)
    │  NIP-44 encrypt to recipient
    ▼
kind:13 seal (signed by you, random timestamp)
    │  NIP-44 encrypt with ephemeral key
    ▼
kind:1059 gift wrap (signed by ephemeral key, p-tag → recipient)
    │
    ▼  Published to recipient's NIP-10050 preferred DM relays
```

A separate gift wrap is also created for **yourself** so you can read your sent messages.

### Privacy guarantees

- **No metadata leak** — relay sees only a gift wrap with a `p` tag; not who sent it, not when, not what kind
- **Deniable** — the inner rumor is unsigned; if leaked it cannot be cryptographically attributed
- **NIP-44 encryption** — XChaCha20-Poly1305, the latest Nostr encryption standard
- **Randomised timestamps** — up to 2 days in the past on both seal and gift wrap to prevent timing correlation
- **Ephemeral keys** — each gift wrap uses a fresh one-time signing key

### Decryption requirement

Because NIP-17 requires your **private key** for decryption (to derive the NIP-44 conversation key), browser extension signers that do not expose the private key cannot decrypt received messages without entering the key manually. This is a known limitation of the NIP-17 specification — decryption must happen client-side with the raw key.

---

## Lightning Zaps (NIP-57 + NWC)

### Nostr Wallet Connect (NWC)

1. Open the **Lightning Wallet** panel in the sidebar
2. Click **Add** and paste a `nostr+walletconnect://` URI from your wallet
3. Zap any note directly — NWC handles payment automatically

### WebLN

If you have a WebLN-compatible browser extension (e.g. Alby), it is detected automatically and used for zap payments.

### Zap flow

```
Click ⚡ Zap on a note
    │
    ▼
Fetch recipient's LNURL endpoint (NIP-57)
    │
    ▼
Build & sign zap request (kind:9734)
    │
    ▼
Fetch Lightning invoice from LNURL server
    │
    ▼  Try NWC → Try WebLN → Show QR code
Pay invoice
```

---

## Media Uploads (NIP-96 + NIP-98)

Attach images, videos, and audio to notes using your configured media host:

1. Go to **Media Hosts** and add a Blossom or NIP-96 server URL
2. Click **Probe** to auto-discover API endpoint and file size limits
3. When composing a note, select the file and your host → upload uses NIP-98 auth

### NIP-98 HTTP Auth

Every upload is authenticated with a signed `kind:27235` event containing:
- The upload URL
- The HTTP method (`POST`)
- A SHA-256 hash of the file payload

This prevents unauthorized use of your storage quota.

---

## Key Management

| Action | Description |
|---|---|
| **Generate** | Creates a new secp256k1 keypair locally |
| **Encrypt & Save** | AES-256-GCM with PBKDF2 (100k iterations) stored in localStorage |
| **Decrypt Saved** | Restore an encrypted key to memory with your password |
| **Export Backup** | Downloads an encrypted JSON backup file |
| **Nostr Login** | Extension (NIP-07), nsec paste, or NIP-46 bunker |

> **Security note:** Never share your `nsec` or hex private key. The encrypt/save feature uses strong AES-256-GCM encryption so your key at rest is protected.

---

## Relay Management (NIP-65)

- Add, remove, and mark relays as **read** / **write**
- Your relay list is published as a `kind:10002` NIP-65 event when logged in
- Live status checks via WebSocket ping
- Suggested popular relays listed for quick setup

---

## Themes

| Theme | Style |
|---|---|
| Default Light | Clean white |
| Dark | Deep navy |
| Solarized Light | Warm yellow |
| Solarized Dark | Dark teal |
| Terminal | Green on black |
| Ocean | Deep ocean blue |
| Forest | Dark green |
| Desert | Warm sand |
| Vintage | Aged parchment |
| Neon | Magenta on black |
| Monokai | Code editor |
| Dracula | Purple/dark |
| Gruvbox Light | Warm retro |
| Gruvbox Dark | Dark retro |
| Midnight | Deep blue |

---

## Tech Stack

- **React 19** — concurrent rendering, hooks
- **TailwindCSS 3** — utility-first styling
- **shadcn/ui** — accessible Radix UI components
- **Nostrify** — Nostr protocol framework
- **TanStack Query** — data fetching & caching
- **nostr-tools** — NIP-44, NIP-59, gift wrap helpers
- **React Router 6** — client-side routing
- **@getalby/sdk** — Nostr Wallet Connect

---

## Running Locally

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

---

## Project Structure

```
src/
├── components/
│   ├── AppLayout.tsx        # Sidebar + header shell
│   ├── NoteCard.tsx         # Feed note with actions
│   ├── NoteContent.tsx      # Rich text / link rendering
│   ├── WalletModal.tsx      # NWC + WebLN management
│   ├── ZapButton.tsx        # Per-note zap trigger
│   ├── ZapDialog.tsx        # Zap amount dialog
│   ├── EditProfileForm.tsx  # Kind-0 profile editor
│   ├── RelayListManager.tsx # NIP-65 relay editor
│   └── auth/                # Login, signup, account switcher
├── pages/
│   ├── FeedPage.tsx         # Global feed + compose
│   ├── CustomFeedPage.tsx   # Per-pubkey feeds
│   ├── ProfilePage.tsx      # Own profile + posts
│   ├── DirectoryPage.tsx    # Profile search
│   ├── ShieldedPage.tsx     # NIP-17 Private DMs ← NIP-04 replaced
│   ├── KeysPage.tsx         # Key generation / encryption
│   ├── RelaysPage.tsx       # Relay management
│   ├── MediaHostsPage.tsx   # NIP-96/98 hosts
│   └── NIP19Page.tsx        # npub/note/nevent viewer
├── hooks/
│   ├── useFeed.ts           # Infinite-scroll feed query
│   ├── useNostrPublish.ts   # Signed event publishing
│   ├── useAuthor.ts         # Kind-0 profile fetch
│   ├── useUploadFile.ts     # Blossom file upload
│   ├── useZaps.ts           # Zap fetch + send
│   ├── useWallet.ts         # WebLN + NWC detection
│   └── useNWC.ts            # NWC connection management
└── contexts/
    ├── AppContext.ts         # Theme + relay config
    └── NWCContext.tsx        # NWC provider
```

---

## Supported NIPs

| NIP | Description |
|---|---|
| NIP-01 | Basic protocol — events, filters, subscriptions |
| NIP-02 | Contact lists |
| NIP-07 | Browser extension signing |
| NIP-10 | Text note threading / replies |
| NIP-17 | **Private Direct Messages** (NIP-44 + NIP-59) |
| NIP-19 | Bech32 identifiers (npub, nsec, note, nevent, naddr) |
| NIP-25 | Reactions (kind 7) |
| NIP-44 | Versioned encryption (XChaCha20-Poly1305) |
| NIP-46 | Nostr Connect / remote signing |
| NIP-57 | Lightning Zaps |
| NIP-59 | Gift Wrap (seal + wrap) |
| NIP-65 | Relay list metadata |
| NIP-96 | HTTP file storage |
| NIP-98 | HTTP Auth |
| NWC | Nostr Wallet Connect |

---

## License

MIT

---

*Vibed with [Shakespeare](https://shakespeare.diy)*
