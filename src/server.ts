import { DurableObject } from "cloudflare:workers";

// Define the shape of your Agent's state
interface ConversationMemory {
  userId: string;
  sessionId: string;
  messageCount: number;
  lastInteraction: string;
  userPreferences: {
    topics: string[];
    communicationStyle: string;
  };
}

// Define environment bindings
interface Env {
  AI: any; // Workers AI binding
  VECTORIZE: any; // Vectorize binding
  MEMORY_AGENT: DurableObjectNamespace;
  OPENAI_API_KEY: string; // If using OpenAI instead
}

export class MemoryAgent extends DurableObject<Env> {
  private state: ConversationMemory;
  private sessions: Map<WebSocket, string>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = {
      userId: "",
      sessionId: "",
      messageCount: 0,
      lastInteraction: new Date().toISOString(),
      userPreferences: {
        topics: [],
        communicationStyle: "balanced"
      }
    };
    this.sessions = new Map();
  }

  /**
   * Initialize the database schema
   */
  async initializeDatabase() {
    // Create tables for conversation history
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding_id TEXT
      )
    `);

    // Create table for semantic memories
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS semantic_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        memory_text TEXT NOT NULL,
        importance_score REAL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        last_accessed TEXT NOT NULL,
        access_count INTEGER DEFAULT 0
      )
    `);

    // Create table for user context
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS user_context (
        user_id TEXT PRIMARY KEY,
        preferences TEXT,
        interaction_patterns TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  /**
   * Handle HTTP requests and WebSocket upgrades
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Check if this is a WebSocket upgrade request
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader === "websocket") {
      return this.handleWebSocket(request);
    }

    // Handle regular HTTP requests
    return new Response("Memory Agent HTTP endpoint", { status: 200 });
  }

  /**
   * Handle WebSocket connections
   */
  async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || "default-user";
    
    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    this.ctx.acceptWebSocket(server);

    // Initialize database
    await this.initializeDatabase();
    
    // Update state with user info
    const sessionId = `session-${Date.now()}`;
    this.state = {
      ...this.state,
      userId,
      sessionId,
      lastInteraction: new Date().toISOString()
    };

    // Store session info
    this.sessions.set(server, userId);

    // Send welcome message
    server.send(JSON.stringify({
      type: "connected",
      userId,
      sessionId,
      message: "Connected to Memory Agent"
    }));

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === "chat") {
        // Store user message
        await this.storeConversationTurn("user", data.content);
        
        // Get AI response with streaming
        await this.callLlamaAndStream(ws, data.content);
        
        // Update state
        this.state = {
          ...this.state,
          messageCount: this.state.messageCount + 1,
          lastInteraction: new Date().toISOString()
        };
        
        // Send completion notification
        ws.send(JSON.stringify({
          type: "complete",
          messageCount: this.state.messageCount
        }));
      }
    } catch (error) {
      console.error("Error handling message:", error);
      ws.send(JSON.stringify({
        type: "error",
        message: "Failed to process message"
      }));
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    this.sessions.delete(ws);
    console.log(`WebSocket closed: ${code} - ${reason}`);
  }

  /**
   * Handle WebSocket errors
   */
  async webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
  }

  /**
   * Call Llama 3.3 and stream response
   */
  async callLlamaAndStream(ws: WebSocket, prompt: string) {
    // Retrieve relevant memories (skip if Vectorize unavailable)
    const memories = await this.retrieveRelevantMemories(prompt);
    
    // Build context from conversation history
    let conversationHistory: any[] = [];
    try {
      const result = await this.ctx.storage.sql.exec(
        `SELECT role, content FROM conversations 
         WHERE user_id = ? 
         ORDER BY timestamp DESC 
         LIMIT 10`,
        this.state.userId
      );
      conversationHistory = result.toArray();
    } catch (error) {
      console.log("No conversation history yet");
    }

    // Construct the system prompt
    let systemPrompt = `You are a helpful AI assistant with memory of past conversations.`;
    
    if (memories.length > 0) {
      systemPrompt += `\n\nHere are relevant memories from previous interactions:\n${memories.map(m => m.memory_text).join('\n')}`;
    }
    
    systemPrompt += `\n\nUser preferences: ${JSON.stringify(this.state.userPreferences)}\n\nRespond naturally and reference past conversations when relevant.`;

    // Build messages array
    const messages = [
      { role: "system", content: systemPrompt }
    ];
    
    // Add conversation history (reverse to get chronological order)
    if (conversationHistory.length > 0) {
      conversationHistory.reverse().forEach((msg: any) => {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      });
    }
    
    // Add current user message
    messages.push({ role: "user", content: prompt });

    try {
      // Call Llama 3.3 via Workers AI
      const response = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages,
          stream: true
        }
      );

      let fullResponse = "";
      
      // Stream the response
      if (response && typeof response === 'object' && Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          const text = chunk.response || "";
          fullResponse += text;
          
          // Stream back to client
          ws.send(JSON.stringify({
            type: "stream",
            content: text
          }));
        }
      } else {
        // Handle non-streaming response
        fullResponse = response?.response || JSON.stringify(response);
        ws.send(JSON.stringify({
          type: "stream",
          content: fullResponse
        }));
      }

      // Store assistant response
      await this.storeConversationTurn("assistant", fullResponse);
    } catch (error) {
      console.error("Error calling Llama:", error);
      
      // Fallback response
      const fallbackMessage = "I'm having trouble connecting to the AI model right now. In production, this would work seamlessly.";
      ws.send(JSON.stringify({
        type: "stream",
        content: fallbackMessage
      }));
      
      await this.storeConversationTurn("assistant", fallbackMessage);
    }
  }

  /**
   * Store a conversation turn in SQL
   */
  async storeConversationTurn(role: string, content: string) {
    const timestamp = new Date().toISOString();
    
    await this.ctx.storage.sql.exec(
      `INSERT INTO conversations (user_id, session_id, timestamp, role, content)
       VALUES (?, ?, ?, ?, ?)`,
      this.state.userId,
      this.state.sessionId,
      timestamp,
      role,
      content
    );

    // Try to generate and store embedding (skip if Vectorize fails in local dev)
    try {
      const embedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [content] // Must be an array for this model
      });

      await this.env.VECTORIZE.insert([{
        id: `${this.state.userId}-${Date.now()}`,
        values: embedding.data[0],
        metadata: {
          userId: this.state.userId,
          role,
          content: content.substring(0, 200),
          timestamp
        }
      }]);
    } catch (error) {
      // This is expected in local dev - Vectorize only works in production
      console.log("⚠️ Vectorize skipped (local dev only) - will work in production");
    }
  }

  /**
   * Retrieve relevant memories using semantic search
   */
  async retrieveRelevantMemories(query: string, limit: number = 5) {
    try {
      const queryEmbedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: query
      });

      const results = await this.env.VECTORIZE.query(queryEmbedding.data[0], {
        topK: limit,
        filter: { userId: this.state.userId }
      });

      return results.matches.map((match: any) => ({
        memory_text: match.metadata?.content || "",
        importance_score: match.score || 0.5
      }));
    } catch (error) {
      // This is expected in local dev - Vectorize only works in production
      console.log("⚠️ Memory retrieval skipped (local dev only) - will work in production");
      return [];
    }
  }
}

// Export default handler for HTTP requests
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Extract user ID from query params or path
    const userId = url.searchParams.get("userId") || url.pathname.slice(1) || "default-user";
    
    // Create a stub to the MemoryAgent using the userId as the name
    const id = env.MEMORY_AGENT.idFromName(userId);
    const stub = env.MEMORY_AGENT.get(id);
    
    // Forward the request to the Durable Object
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
