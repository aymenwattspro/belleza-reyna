'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatContextType {
  messages: ChatMessage[];
  apiKey: string;
  isOpen: boolean;
  isStreaming: boolean;

  setApiKey: (key: string) => void;
  setIsOpen: (open: boolean) => void;
  sendMessage: (text: string, contextData?: string) => Promise<void>;
  clearChat: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const STORAGE_KEY = 'br_chat_history';
const API_KEY_STORAGE = 'br_gemini_key';

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [apiKey, setApiKeyState] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // Load persisted chat + key on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setMessages(
          parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
        );
      }
      const storedKey = localStorage.getItem(API_KEY_STORAGE);
      if (storedKey) setApiKeyState(storedKey);
    } catch {}
  }, []);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    localStorage.setItem(API_KEY_STORAGE, key);
  }, []);

  const persistMessages = (msgs: ChatMessage[]) => {
    // Keep only last 100 messages to avoid bloat
    const trimmed = msgs.slice(-100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    return trimmed;
  };

  const sendMessage = useCallback(
    async (text: string, contextData?: string) => {
      if (!text.trim() || isStreaming) return;

      const userMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      };

      const updatedMsgs = persistMessages([...messages, userMsg]);
      setMessages(updatedMsgs);

      // Placeholder for streaming assistant response
      const assistantId = `msg_${Date.now() + 1}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setIsStreaming(true);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            messages: updatedMsgs.map((m) => ({
              role: m.role,
              parts: [{ text: m.content }],
            })),
            contextData,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'API error');
        }

        // Stream the response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            fullContent += chunk;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: fullContent } : m
              )
            );
          }
        }

        // Persist final state
        setMessages((prev) => {
          const final = prev.map((m) =>
            m.id === assistantId ? { ...m, content: fullContent } : m
          );
          persistMessages(final);
          return final;
        });
      } catch (err: any) {
        const errorContent =
          `⚠️ ${err.message || 'Could not reach Gemini API. Please check your API key.'}`;
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantId ? { ...m, content: errorContent } : m
          );
          persistMessages(updated);
          return updated;
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, apiKey, isStreaming]
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        apiKey,
        isOpen,
        isStreaming,
        setApiKey,
        setIsOpen,
        sendMessage,
        clearChat,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
