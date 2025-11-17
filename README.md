# 🤖 cf_ai_memory_agent — Cloudflare Memory AI Agent

A fully custom conversational AI system built using Cloudflare Workers, Durable Objects, Workers AI, Vectorize, and a persistent MemoryAgent capable of long-term memory, semantic recall, and real-time WebSocket streaming.

This project was built for the Cloudflare AI Challenge and includes all required components: PROMPTS.md, documentation, running instructions, and an AI-assisted development log.

---

## 🚀 Live Demo (after deployment)

https://<your-worker-subdomain>.workers.dev

---

# 📌 Overview

This project implements a stateful conversational AI agent that:

- Remembers previous conversations  
- Stores long-term memory using SQLite (inside a Durable Object)  
- Uses Workers AI to embed messages  
- Performs semantic recall using Cloudflare Vectorize  
- Streams Llama 3.3 responses to the browser in real-time  
- Provides a React-based chat UI  
- Handles multiple parallel user sessions  
- Automatically falls back gracefully during local development

---

# ✨ Features

### 🧠 Persistent Memory  
Conversation turns are stored in an embedded SQL database.  
Messages are vectorized for semantic retrieval using Vectorize.

### 🔎 Semantic Search  
Every message is embedded via Workers AI (`@cf/baai/bge-base-en-v1.5`) and stored remotely in Vectorize.

### 🧵 Real-time Streaming AI  
Powered by Workers AI using:  
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`

### 🌐 WebSocket Chat  
The frontend uses a two-way WebSocket connection to stream messages live.

### 🎨 Custom React Frontend  
Includes:
- Dark/light themes  
- Typing indicators  
- Memory statistics  
- Streaming animations  
- Auto-scroll behavior  

### 🧩 Durable Object Agent  
MemoryAgent manages:
- WebSocket lifecycle  
- AI prompt construction  
- SQL storage  
- Vector embeddings  
- Memory retrieval  
- Local-dev fallbacks  
- User state synchronization  

---

# 🗂️ Project Structure

cf_ai_memory_agent/
├── src/
│ ├── server.ts # Durable Object MemoryAgent
│ ├── app.tsx # React chat UI
│ ├── styles.css # UI styling
│ └── index.html
├── wrangler.jsonc # Bindings (AI, Vectorize, Durable Objects)
├── package.json
├── README.md
└── PROMPTS.md # Required by challenge


---

🧠 How Memory Works
1. Store conversation
Each turn is stored in SQLite:
role
content
timestamp
session id

2. Embed messages
Workers AI generates a vector embedding.

3. Insert embeddings into Vectorize
Stored with metadata:
userId
timestamp
message preview

4. Semantic memory recall
On each new query:
Embed the query
Search Vectorize top-k
Retrieve most relevant memories
Inject them into the system prompt

5. LLM reasoning
Llama 3.3 produces a final response using context + memory.

6. Stream results to UI
Tokens stream live over WebSocket.

🛠️ MemoryAgent Responsibilities
Includes:
WebSocket upgrade handling
Real-time message streaming
SQL conversation storage
Embedding + Vectorize insertion
Semantic memory retrieval
Local-dev fallback handling
State syncing
Key functions:
webSocketMessage()
storeConversationTurn()
retrieveRelevantMemories()
callAndStream()
initializeDatabase()

🎨 Frontend Features
React + Vite UI includes:
Message bubbles
Streaming tokens
Typing indicators
Auto-scroll
Memory stats panel
Connection status display
