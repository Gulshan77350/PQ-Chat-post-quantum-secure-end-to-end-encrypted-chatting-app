# 🔐 PQ-Chat — Post-Quantum Secure End-to-End Encrypted Chat Application

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](https://opensource.org/licenses/MIT)
[![Framework](https://img.shields.io/badge/Next.js-16.0-black?logo=next.js)](https://nextjs.org/)
[![Cryptography](https://img.shields.io/badge/NIST-ML--KEM--512-blue)](https://csrc.nist.gov/projects/post-quantum-cryptography)
[![Real-Time](https://img.shields.io/badge/Socket.IO-v4.8-green?logo=socket.io)](https://socket.io/)

**PQ-Chat** is a production-hardened, non-custodial, post-quantum secure end-to-end encrypted (E2EE) real-time messaging application. Built with **Next.js**, **Socket.IO**, and **MongoDB**, all cryptographic operations occur strictly client-side in the browser using NIST-standardized **ML-KEM-512 (Kyber)** lattice-based key encapsulation combined with **AES-256-GCM** payload encryption, per-message **SHA-256 key ratcheting**, and **TOFU (Trust-On-First-Use) safety numbers**.

---

## 📱 Application Screenshots

| 1. Non-Custodial Login | 2. Account Registration & Password Strength |
| :---: | :---: |
| ![Login Page](screenshots/Screenshot%20from%202026-07-29%2018-05-56.png) | ![Registration Page](screenshots/Screenshot%20from%202026-07-29%2018-06-05.png) |

| 3. Real-Time Encrypted Chat UI | 4. Account Password Reset |
| :---: | :---: |
| ![Chat Interface](screenshots/Screenshot%20from%202026-07-29%2017-59-02.png) | ![Forgot Password](screenshots/Screenshot%20from%202026-07-29%2018-14-58.png) |


---

## 🚀 What is PQ-Chat?

Modern asymmetric encryption algorithms (RSA, ECDH) will be trivially broken by quantum computers running Shor's algorithm. **PQ-Chat** protects conversations against "harvest-now, decrypt-later" quantum adversaries by combining post-quantum lattice cryptography with modern web architectures:

1. **Non-Custodial Architecture**: The server only ever sees encrypted ciphertexts and public keys. Private keys are generated in browser WebCrypto memory and exported into passphrase-wrapped `.pqkey` files.
2. **Post-Quantum Key Exchange (ML-KEM-512)**: Implements NIST FIPS 203 Kyber-512 for quantum-resistant key encapsulation.
3. **Forward Secrecy (Message Key Ratcheting)**: Derives ephemeral single-use AES payload keys per message sequence via HKDF-SHA256 ratcheting.
4. **Out-of-Band Verification (Safety Numbers)**: Provides a 30-digit deterministic public key fingerprint for TOFU key authentication against MITM attacks.
5. **Fail-Closed API Security & Rate Limiting**: Enforces strict environment variable verification and sliding-window rate-limiting across all REST endpoints.

---

## 🛠️ Technology Stack

- **Frontend**: Next.js 16 (React), TailwindCSS, Lucide Icons, React Hot Toast
- **Backend**: Node.js, Custom Express-wrapped Server (`server.js`), Socket.IO
- **Database**: MongoDB (Mongoose ODM)
- **Cryptography**: `crystals-kyber-js` (ML-KEM-512), Web Crypto API (PBKDF2-SHA256, AES-256-GCM, HKDF-SHA256)

---

## 💻 Quick Start & Setup

### Prerequisites
- Node.js >= 18.x
- MongoDB running locally (`mongodb://localhost:27017`) or Docker

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Gulshan77350/PQ-Chat-post-quantum-secure-end-to-end-encrypted-chatting-app.git
cd PQ-Chat-post-quantum-secure-end-to-end-encrypted-chatting-app
npm install
```

### 2. Environment Configuration
Create a `.env` file based on `.env.example`:
```env
PORT=3000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/pqchat
JWT_SECRET=your_super_secret_jwt_key_here
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### 3. Start MongoDB & Launch Application
```bash
# Start MongoDB via Docker
docker run -d -p 27017:27017 --name pqchat-mongo mongo:latest

# Run Development / Production Server
node server.js
```
Open **`http://localhost:3000`** in your browser.

---

# 📚 PQ-Chat — Interview Prep Guide

*Grounded in the production codebase (`lib/pqcrypto.js`, `lib/socket.js`, `models/`, `pages/api/`).*

---

## 1. The 30-Second Pitch

> "I built a non-custodial, post-quantum secure end-to-end encrypted chat app — Next.js + Socket.IO + MongoDB on the backend, with all cryptography happening client-side in the browser using the Web Crypto API. Key exchange uses ML-KEM-512 (Kyber), the NIST-standardized lattice-based KEM that's secure against quantum adversaries, combined with AES-256-GCM for the actual message payload — a hybrid KEM/DEM construction, the same pattern TLS 1.3 hybrid post-quantum ciphersuites use. Private keys are generated in-browser, never transmitted, and wrapped with a passphrase-derived key (PBKDF2, 100k iterations) into a downloadable `.pqkey` file — so the server only ever sees ciphertext and public keys, even though I'm not running a fully custody-free protocol like Signal."

---

## 2. Architecture at a Glance

```
Browser A                          Server                          Browser B
─────────                          ──────                          ─────────
Kyber keygen (client)     ──POST /api/users (pubkey only)──▶   MongoDB (Users)
.pqkey downloaded locally
                                     │
Login → decrypt .pqkey          Socket.IO room = username
  (PBKDF2 + AES-GCM)                │
                                     │
encryptMessage(text,
  receiverPub, senderPub)  ──POST /api/message──▶  Message doc saved
  → AES-GCM(payload)                │                (ciphertext + 2 KEM
  → Kyber-encap(payloadKey)         │                 ciphertexts, never
    for receiver AND sender         │                 plaintext)
                                     │
                            io.to(receiver).emit("message:new")
                            io.to(sender).emit("message:new")
                                     │
                                                        decryptMessage()
                                                        using local private
                                                        key + Kyber decap
```

Custom Express-style Node server (`server.js`) wraps the Next.js request handler and a single Socket.IO instance so both HTTP API routes and WebSocket rooms run in one process.

---

## 3. Cryptography — Deep Dive

### 3.1 Why hybrid KEM + AES, not "just encrypt with Kyber"?

Kyber (ML-KEM) is a **Key Encapsulation Mechanism**, not a general-purpose cipher — it only lets two parties agree on a shared secret, it can't encrypt arbitrary-length data efficiently. So the standard, NIST-recommended pattern (and what TLS 1.3 PQ hybrid mode does) is:

1. Generate a random 256-bit symmetric key (the **payload key**) per message.
2. Encrypt the actual plaintext with that key using **AES-256-GCM** (fast, authenticated, arbitrary length).
3. Encapsulate *that symmetric key* — not the message — using the recipient's Kyber public key.
4. Ship both the AES ciphertext and the small Kyber-encapsulated key container.

This is exactly what `encryptMessage()` in `lib/pqcrypto.js` does: it generates `payloadKeyBytes` (32 random bytes), AES-GCM-encrypts the plaintext with it, then calls `encapsulatePayloadKey()` which runs `kyber.encap(publicKey)` to get a Kyber ciphertext + shared secret, and uses that shared secret to AES-GCM-wrap the payload key. So there are actually **two layers of AES-GCM**: one for the message, one for the payload key itself (keyed by the Kyber shared secret).

**Interviewer question: "Why not just derive the AES key directly from the Kyber shared secret?"**
Because a payload key generated locally lets you encapsulate the *same* key for multiple recipients (see 3.2) without re-encrypting the message body for each one — you only re-run the cheap Kyber encapsulation, not the AES encryption of potentially large media.

### 3.2 Dual-recipient encapsulation — the "why" that interviewers will probe hardest

Every message encrypts the payload key **twice**: once under the receiver's Kyber public key (`encryptedKey`) and once under the sender's own Kyber public key (`senderEncryptedKey`). Both ciphertext containers are stored in MongoDB (see `models/Message.js`).

Why: in a standard asymmetric scheme, the sender encrypts only for the receiver's public key. That means the *sender* can't decrypt their own sent messages later — there's no way to recover the payload key with only the sender's private key, since it was never encapsulated for them. Without this, refreshing the page would make your own sent messages unreadable, and there's no server-side plaintext to fall back on (by design — that's the whole point of E2EE). Dual encapsulation gives you non-custodial persistence across reloads/tabs without ever storing plaintext or a shared "conversation key" server-side.

`decryptMessage()` tries `senderEncryptedKey` first if `isMe` is true (you're viewing your own sent message) and falls back to `encryptedKey`, or vice versa — this is the `keysToTry` array logic.

### 3.3 Non-custodial key management & In-Memory Isolation

- `generateKeyPair()` runs Kyber-512 keygen **in the browser** (`crystals-kyber-js`), so the private key is born client-side and never touches an HTTP request during registration — only `toB64(publicKey)` is sent to `/api/users`.
- `exportEncryptedKeyFile()` derives an AES-256 key from the user's passphrase via **PBKDF2-SHA256, 100,000 iterations**, generates a random salt + IV, and AES-GCM-encrypts the raw private key bytes. That wrapped blob (plus salt/iv/metadata) becomes the downloadable `.pqkey` JSON file — this is structurally identical to how PGP/OpenSSH wrap private keys with a passphrase.
- On login, `decryptKeyFile(password, keyFileObj)` re-derives the same key from the passphrase + stored salt and unwraps the private key locally.
- **In-Memory Vault**: Private keys are kept in JS module memory (`inMemoryPrivateKeyStore`), purging all private key data upon logout (`clearSessionKeys()`).

### 3.4 Security Properties & Trade-Offs

**Does provide:**
- Confidentiality against network attackers and server operators (server only sees ciphertext + public keys — verified in `models/Message.js` schema and `/api/message.js`).
- Post-quantum confidentiality for the key-exchange step — a "harvest now, decrypt later" adversary storing today's Kyber ciphertexts cannot recover the payload key even with a future quantum computer.
- Integrity/authenticity of ciphertext via AES-**GCM**'s built-in authentication tag.
- Forward Secrecy per message sequence via HKDF-SHA256 key ratcheting.
- Out-of-band TOFU public key fingerprint verification (`SafetyNumberModal.js`).

### 3.5 Why ML-KEM-512 specifically, not 768/1024?

Kyber-512 targets NIST security category 1 (roughly equivalent to AES-128 brute-force resistance) — smaller keys/ciphertexts (~800 bytes public key vs ~1184 for 768) and faster keygen/encap, which matters for in-browser generation and dual-encapsulation overhead per message. Swapping to `MlKem768` is a one-line change in `lib/pqcrypto.js`.

---

## 4. Real-Time Layer (Socket.IO)

- `lib/socket.js` initializes a **singleton** `Server` instance attached to the same HTTP server Next.js uses (`server.js` calls `initIO(server)` once, guarded by the `if (io) return io` check) — avoids Next.js dev-mode double-init bugs.
- **Room-based routing**: on connection, each socket does `socket.join(username)` — so `io.to(username).emit(...)` reaches every tab/device that user has open.
- Presence: `presence:snapshot` on connect gives the new client the full online-user list; `presence:online`/`presence:offline` broadcast deltas.

---

## 5. Likely Interview Questions & Model Answers

**Q: Walk me through what happens end-to-end when I hit send on a message.**  
*A: Client has receiver's Kyber public key and its own. `encryptMessage()` generates a 256-bit payload key, AES-256-GCM encrypts the payload, encapsulates the payload key under both public keys via Kyber, and POSTs the ciphertext object to `/api/message`. Mongo saves the ciphertext document, Socket.IO emits `message:new` to room listeners, and receiving clients decapsulate using their private key to recover the payload.*

**Q: Is this actually quantum-resistant end-to-end, or just the key exchange?**  
*A: The key exchange is post-quantum (ML-KEM-512). AES-256-GCM is already considered quantum-resistant in practice (Grover's algorithm only halves key strength to 128-bit security). Replacing asymmetric key exchange with Kyber creates a post-quantum hybrid KEM/DEM architecture.*

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for details.
