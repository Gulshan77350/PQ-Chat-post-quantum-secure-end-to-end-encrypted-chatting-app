# 🔐 PQ-Chat: Post-Quantum Secure End-to-End Encrypted (E2EE) Chat

A state-of-the-art **Non-Custodial, Post-Quantum Secure End-to-End Encrypted Real-Time Chat Platform** built with **Next.js, Node.js, Socket.IO, MongoDB, and NIST-Standardized ML-KEM-512 (Kyber-512) Cryptography**.

---

## 🌟 Key Highlights & Security Architecture

- **🔒 Post-Quantum Encryption (ML-KEM-512 / Kyber-512)**: Uses NIST-standardized quantum-resistant lattice algorithms for asymmetric key encapsulation combined with AES-GCM (256-bit) for symmetric payload encryption.
- **🔑 PGP-Style Non-Custodial Key Architecture**: Private keys are generated entirely in the browser and wrapped via PBKDF2 (100,000 iterations) + AES-GCM into downloadable `.pqkey` passphrase-protected files. Private keys **never** touch network traffic or database storage.
- **⚡ Dual-Recipient Key Encapsulation**: Payload keys are encapsulated for **both** sender and receiver, enabling non-custodial sender message persistence across session reloads and multi-tab sync.
- **💬 Real-Time Engine**: Built on Socket.IO room-based dynamic subscriptions (`socket.join(username)`), providing instant message delivery, live presence tracking, seen receipts, and typing indicators.
- **🗑️ Zero-Trace Clear Chat**: Direct database conversation purging with real-time socket propagation across active tabs.

---

## 🛠️ Tech Stack

| Domain | Technologies |
| :--- | :--- |
| **Frontend** | React, Next.js (Page Router), Framer Motion, Lucide Icons, Vanilla CSS |
| **Cryptography** | `crystals-kyber-js` (ML-KEM-512 / Kyber), Web Crypto API (PBKDF2, AES-GCM) |
| **Backend & Real-Time** | Node.js, Express, Socket.IO (WebSockets), Next.js API Routes |
| **Database** | MongoDB & Mongoose (Indexed Schemas) |
| **Authentication** | Passphrase-Derived Key Wrapping + JWT (JSON Web Tokens) |

---

## 🚀 How to Run the Application on Any System

Follow these simple steps to set up and run **PQ-Chat** on Linux, macOS, or Windows.

### 📋 Prerequisites

Make sure you have installed:
1. **Node.js**: `v18.x` or higher (`v20.x` recommended) — [Download Node.js](https://nodejs.org/)
2. **MongoDB**: Local MongoDB instance (`mongodb://127.0.0.1:27017`) OR a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) connection URI.

---

### 1️⃣ Clone the Repository & Install Dependencies

```bash
git clone https://github.com/Gulshan77350/PQ-Chat-post-quantum-secure-end-to-end-encrypted-chatting-app.git
cd PQ-Chat-post-quantum-secure-end-to-end-encrypted-chatting-app

# Install all dependencies
npm install
```

---

### 2️⃣ Configure Environment Variables

Create a `.env.local` file in the root directory:

```bash
# For Local MongoDB (Default)
MONGO_URI=mongodb://127.0.0.1:27017/pqchat
MONGO_URI_LOCAL=mongodb://127.0.0.1:27017/pqchat
USE_ONLINE_DB=false
PORT=3000
JWT_SECRET=supersecretpqchatkey2026

# OR For Online MongoDB Atlas (Set USE_ONLINE_DB=true)
# MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/pqchat
# USE_ONLINE_DB=true
```

---

### 3️⃣ Run the Application

#### 🔹 Option A: Production Mode (Recommended)
Build the Next.js bundle and start the custom Express + Socket.IO server:

```bash
npm run build
npm start
```

#### 🔹 Option B: Development Mode
Run with live reloading enabled:

```bash
npm run dev
```

---

### 4️⃣ Access the Chat Application

Open your browser and navigate to:
👉 **`http://localhost:3000`**

---

## 💡 How to Test PQC E2EE Messaging

1. **Register User A**: Click **Register**, enter a username (e.g. `alice`) and passphrase. The browser will automatically generate a Kyber keypair and download `pqchat_alice.pqkey`.
2. **Register User B**: In a new tab/browser window, register User B (e.g. `bob`). Download `pqchat_bob.pqkey`.
3. **Login**: Login with credentials and select your `.pqkey` file to unlock your local session key.
4. **Chat in Real-Time**: Select the user from the sidebar and send encrypted messages.
5. **Verify Non-Custodial Persistence**: Refresh the browser page — sent and received messages remain fully persistent and decrypted seamlessly using local Kyber key decapsulation!

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
