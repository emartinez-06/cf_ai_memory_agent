import React, { useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";

// Message type definition
interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

// Memory stats interface
interface MemoryStats {
  messageCount: number;
  lastInteraction: string;
  topics: string[];
  userId: string;
  sessionId: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [memoryStats, setMemoryStats] = useState<MemoryStats>({
    messageCount: 0,
    lastInteraction: "",
    topics: [],
    userId: "",
    sessionId: ""
  });
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Generate a user ID (in production, this would come from auth)
  const userId = useRef(`user-${Math.random().toString(36).substr(2, 9)}`);

  // Manual WebSocket connection
  useEffect(() => {
    // Create WebSocket URL - convert http to ws
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/?userId=${userId.current}`;
    
    console.log('Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Connected to Memory Agent");
      setIsConnected(true);
      addSystemMessage("Connected to Memory Agent");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleAgentMessage(data);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    };

    ws.onclose = () => {
      console.log("Disconnected from Memory Agent");
      setIsConnected(false);
      addSystemMessage("Disconnected from Memory Agent");
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      addSystemMessage("Connection error occurred");
    };

    return () => {
      ws.close();
    };
  }, []);

  // Handle messages from the agent
  const handleAgentMessage = (data: any) => {
    switch (data.type) {
      case "connected":
        setMemoryStats(prev => ({
          ...prev,
          userId: data.userId,
          sessionId: data.sessionId
        }));
        break;

      case "stream":
        setIsStreaming(true);
        setStreamingContent(prev => prev + data.content);
        break;

      case "complete":
        if (streamingContent) {
          addMessage("assistant", streamingContent);
          setStreamingContent("");
        }
        setIsStreaming(false);
        setMemoryStats(prev => ({
          ...prev,
          messageCount: data.messageCount,
          lastInteraction: new Date().toISOString()
        }));
        break;

      case "error":
        addSystemMessage(`Error: ${data.message}`);
        setIsStreaming(false);
        setStreamingContent("");
        break;
    }
  };

  // Add a message to the chat
  const addMessage = (role: "user" | "assistant" | "system", content: string) => {
    const newMessage: Message = {
      id: `msg-${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const addSystemMessage = (content: string) => {
    addMessage("system", content);
  };

  // Send a message to the agent
  const sendMessage = () => {
    if (!input.trim() || isStreaming || !wsRef.current || !isConnected) return;

    const userMessage = input.trim();
    addMessage("user", userMessage);
    setInput("");

    // Send to agent via WebSocket
    wsRef.current.send(JSON.stringify({
      type: "chat",
      content: userMessage
    }));
  };

  // Handle Enter key
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1>🧠 Memory Agent</h1>
          <p className="subtitle">AI with conversational memory</p>
        </div>
        <button 
          className="memory-toggle-btn"
          onClick={() => setShowMemoryPanel(!showMemoryPanel)}
        >
          {showMemoryPanel ? "Hide" : "Show"} Memory
        </button>
      </header>

      <div className="main-content">
        {/* Memory Stats Panel */}
        {showMemoryPanel && (
          <aside className="memory-panel">
            <h2>Memory Status</h2>
            <div className="memory-stats">
              <div className="stat-item">
                <span className="stat-label">Messages:</span>
                <span className="stat-value">{memoryStats.messageCount}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">User ID:</span>
                <span className="stat-value">{memoryStats.userId || "Not connected"}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Session:</span>
                <span className="stat-value">{memoryStats.sessionId || "Not connected"}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Last Active:</span>
                <span className="stat-value">
                  {memoryStats.lastInteraction 
                    ? new Date(memoryStats.lastInteraction).toLocaleString()
                    : "Never"}
                </span>
              </div>
              {memoryStats.topics.length > 0 && (
                <div className="stat-item">
                  <span className="stat-label">Topics:</span>
                  <div className="topics-list">
                    {memoryStats.topics.map((topic, i) => (
                      <span key={i} className="topic-tag">{topic}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Chat Area */}
        <main className="chat-container">
          <div className="messages-container">
            {messages.length === 0 && (
              <div className="empty-state">
                <h2>👋 Welcome!</h2>
                <p>Start a conversation. I'll remember our chat history and context.</p>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`message message-${message.role}`}>
                <div className="message-header">
                  <span className="message-role">
                    {message.role === "user" ? "You" : 
                     message.role === "assistant" ? "AI" : "System"}
                  </span>
                  <span className="message-time">
                    {message.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div className="message-content">{message.content}</div>
              </div>
            ))}

            {/* Streaming message */}
            {isStreaming && streamingContent && (
              <div className="message message-assistant streaming">
                <div className="message-header">
                  <span className="message-role">AI</span>
                  <span className="message-time">Now</span>
                </div>
                <div className="message-content">
                  {streamingContent}
                  <span className="cursor">▊</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="input-container">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message... (Press Enter to send)"
              className="message-input"
              rows={3}
              disabled={isStreaming}
            />
            <button 
              onClick={sendMessage} 
              disabled={!input.trim() || isStreaming}
              className="send-button"
            >
              {isStreaming ? "Thinking..." : "Send"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
