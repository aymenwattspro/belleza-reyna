'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { MessageCircle, X, Send, Trash2, Key, Bot, User, Loader2, ChevronDown } from 'lucide-react';
import { useChat } from '@/contexts/ChatContext';
import { useInventory } from '@/contexts/InventoryContext';
import { cn } from '@/lib/utils';

export function ChatWidget() {
  const { messages, apiKey, isOpen, isStreaming, setApiKey, setIsOpen, sendMessage, clearChat } =
    useChat();
  const { latestSnapshot, snapshots } = useInventory();

  // Build automatic inventory context for every message
  const autoContext = useMemo(() => {
    if (!latestSnapshot || latestSnapshot.products.length === 0) return undefined;

    const products = latestSnapshot.products;
    const totalValue = products.reduce((s, p) => s + (Math.max(0, p.existencia) * (p.precioC || 0)), 0);
    const outOfStock = products.filter((p) => p.existencia <= 0).length;
    const lowStock = products.filter((p) => p.existencia > 0 && p.existencia < (p.stockObjetivo ?? 0)).length;

    // Margin helper: (salePrice - cost) / salePrice * 100
    const margin = (p: typeof products[0]) => {
      if (!p.precioV || !p.precioC || p.precioV <= 0) return null;
      return ((p.precioV - p.precioC) / p.precioV * 100);
    };

    // Top 20 products by stock value
    const topByValue = [...products]
      .sort((a, b) => (Math.max(0, b.existencia) * (b.precioC || 0)) - (Math.max(0, a.existencia) * (a.precioC || 0)))
      .slice(0, 20);

    const productLines = topByValue
      .map((p) => {
        const m = margin(p);
        const marginStr = m !== null ? `margin=${m.toFixed(1)}%` : 'margin=N/A';
        return `- ${p.descripcion} (${p.clave}): stock=${Math.max(0, p.existencia)}, cost=$${(p.precioC || 0).toFixed(2)}, salePrice=$${(p.precioV || 0).toFixed(2)}, ${marginStr}, target=${p.stockObjetivo ?? '?'}`;
      })
      .join('\n');

    // Top 10 products by profit margin (only products that have a sale price)
    const topByMargin = [...products]
      .filter((p) => p.precioV && p.precioV > 0 && p.precioC > 0)
      .map((p) => ({ ...p, _margin: margin(p)! }))
      .sort((a, b) => b._margin - a._margin)
      .slice(0, 10);

    const marginLines = topByMargin
      .map((p) => `- ${p.descripcion} (${p.clave}): margin=${p._margin.toFixed(1)}%, cost=$${(p.precioC).toFixed(2)}, salePrice=$${(p.precioV!).toFixed(2)}`)
      .join('\n');

    const suppliers = [...new Set(products.map((p) => p.proveedor).filter(Boolean))];

    return `=== BELLEZA REYNA LIVE INVENTORY DATA ===
Import date: ${latestSnapshot.date.toLocaleDateString()}
Supplier: ${latestSnapshot.supplierName || 'General'}
Total products in database: ${products.length}
Total imports/snapshots: ${snapshots.length}
Total inventory value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Out of stock: ${outOfStock} products
Low stock (below target): ${lowStock} products
Suppliers: ${suppliers.join(', ')}

TOP 20 PRODUCTS BY INVENTORY VALUE (includes cost, salePrice, margin):
${productLines}

TOP 10 PRODUCTS BY PROFIT MARGIN:
${marginLines || '(No products with sale price data available)'}

Note: margin = (salePrice - cost) / salePrice * 100. This is real live data from the Belleza Reyna inventory system.
=== END INVENTORY DATA ===`;
  }, [latestSnapshot, snapshots]);
  const [input, setInput] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput('');
    await sendMessage(text, autoContext);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveKey = () => {
    if (keyDraft.trim()) {
      setApiKey(keyDraft.trim());
      setKeyDraft('');
      setShowKeyInput(false);
    }
  };

  // Format message content with basic markdown-like styling
  const formatContent = (content: string) => {
    if (!content) return <span className="animate-pulse">▋</span>;
    return content.split('\n').map((line, i) => (
      <span key={i}>
        {line
          .split(/(\*\*[^*]+\*\*)/g)
          .map((part, j) =>
            part.startsWith('**') && part.endsWith('**') ? (
              <strong key={j}>{part.slice(2, -2)}</strong>
            ) : (
              part
            )
          )}
        {i < content.split('\n').length - 1 && <br />}
      </span>
    ));
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300',
          isOpen
            ? 'bg-gray-800 text-white rotate-0'
            : 'bg-gradient-to-br from-pink-500 to-pink-600 text-white hover:scale-110'
        )}
      >
        {isOpen ? <X size={22} /> : <MessageCircle size={22} />}
        {!isOpen && messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {messages.length > 99 ? '99+' : messages.length}
          </span>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-pink-500 to-pink-600 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Reyna AI</p>
                <p className="text-pink-100 text-xs">
                  {isStreaming ? 'Thinking...' : 'Inventory Assistant'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowKeyInput(!showKeyInput)}
                className="p-1.5 text-pink-100 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                title="Configure API Key"
              >
                <Key size={14} />
              </button>
              <button
                onClick={clearChat}
                className="p-1.5 text-pink-100 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                title="Clear chat"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-pink-100 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>

          {/* API Key Input */}
          {showKeyInput && (
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
              <p className="text-xs text-amber-700 font-medium mb-2">
                🔑 Google Gemini API Key
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={apiKey ? '••••••••••••' : 'AIza...'}
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-amber-300 outline-none focus:border-amber-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                />
                <button
                  onClick={handleSaveKey}
                  className="px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600"
                >
                  Save
                </button>
              </div>
              {apiKey && (
                <p className="text-xs text-emerald-600 mt-1">✓ Key configured</p>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Bot size={32} className="mx-auto text-pink-300 mb-3" />
                <p className="text-sm text-gray-600 font-medium">Hi! I'm Reyna AI</p>
                <p className="text-xs text-gray-400 mt-1">
                  Ask me about inventory, orders, or product performance.
                </p>
                {!apiKey && (
                  <button
                    onClick={() => setShowKeyInput(true)}
                    className="mt-3 text-xs text-pink-500 font-medium underline"
                  >
                    Set up your API key to get started →
                  </button>
                )}
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex gap-2',
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white mt-0.5',
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-pink-500 to-pink-600'
                      : 'bg-gradient-to-br from-gray-600 to-gray-700'
                  )}
                >
                  {msg.role === 'user' ? (
                    <User size={12} />
                  ) : (
                    <Bot size={12} />
                  )}
                </div>
                <div
                  className={cn(
                    'max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-pink-500 to-pink-600 text-white rounded-tr-sm'
                      : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                  )}
                >
                  {formatContent(msg.content)}
                </div>
              </div>
            ))}

            {isStreaming && messages[messages.length - 1]?.content === '' && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center">
                  <Bot size={12} className="text-white" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2">
                  <Loader2 size={16} className="text-gray-400 animate-spin" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-100">
            {!apiKey ? (
              <button
                onClick={() => setShowKeyInput(true)}
                className="w-full py-2 text-sm text-pink-500 font-medium bg-pink-50 rounded-xl border border-pink-200 hover:bg-pink-100 transition-colors"
              >
                🔑 Set Gemini API Key to chat
              </button>
            ) : (
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about inventory..."
                  disabled={isStreaming}
                  rows={1}
                  className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 outline-none focus:border-pink-400 resize-none max-h-24 disabled:opacity-50"
                  style={{ minHeight: '36px' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  className="p-2 bg-gradient-to-br from-pink-500 to-pink-600 text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {isStreaming ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
