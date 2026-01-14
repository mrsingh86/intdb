'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  AlertTriangle,
  PartyPopper,
  Mail,
  Loader2,
  Sparkles,
  MessageSquare,
  ChevronLeft,
} from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';

/**
 * Chronicle Ask - Conversational AI for Shipment Intelligence
 *
 * Features:
 * - Natural language questions about shipments
 * - Daily briefing mode
 * - Celebration mode for departures/deliveries
 * - Email drafting assistance
 */

type AskMode = 'chat' | 'briefing' | 'celebrate' | 'draft';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  mode?: AskMode;
}

// Quick action buttons configuration
const QUICK_ACTIONS = [
  {
    id: 'urgent',
    label: "What's urgent?",
    icon: AlertTriangle,
    mode: 'briefing' as AskMode,
    prompt: "What's urgent today? Give me a briefing.",
    color: 'text-red-400 hover:text-red-300',
    bgColor: 'hover:bg-red-500/10',
  },
  {
    id: 'celebrate',
    label: 'Celebrate wins',
    icon: PartyPopper,
    mode: 'celebrate' as AskMode,
    prompt: 'What should we celebrate? Show me our recent wins!',
    color: 'text-green-400 hover:text-green-300',
    bgColor: 'hover:bg-green-500/10',
  },
  {
    id: 'draft',
    label: 'Draft email',
    icon: Mail,
    mode: 'draft' as AskMode,
    prompt: '',
    color: 'text-blue-400 hover:text-blue-300',
    bgColor: 'hover:bg-blue-500/10',
  },
];

export default function AskPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentMode, setCurrentMode] = useState<AskMode>('chat');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Send message to API
  const sendMessage = useCallback(
    async (message: string, mode: AskMode = 'chat') => {
      if (!message.trim() || isLoading) return;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message.trim(),
        timestamp: new Date(),
        mode,
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setIsLoading(true);
      setCurrentMode(mode);

      // Create assistant message placeholder
      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          mode,
        },
      ]);

      try {
        // Build conversation history (last 10 messages)
        const history = messages.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await fetch('/api/chronicle/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: message.trim(),
            conversationHistory: history,
            mode,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to get response');
        }

        // Read streaming response
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader available');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'text') {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: m.content + data.content }
                        : m
                    )
                  );
                } else if (data.type === 'error') {
                  throw new Error(data.content);
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      } catch (error) {
        console.error('Error:', error);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    "I'm sorry, I encountered an error. Please try again.",
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, messages]
  );

  // Handle form submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input, currentMode);
  };

  // Handle quick action click
  const handleQuickAction = (action: (typeof QUICK_ACTIONS)[number]) => {
    if (action.id === 'draft') {
      // For draft, set mode and let user type
      setCurrentMode('draft');
      setInput('Draft an email about ');
      inputRef.current?.focus();
    } else if (action.prompt) {
      sendMessage(action.prompt, action.mode);
    }
  };

  // Handle Enter key (send on Enter, new line on Shift+Enter)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-terminal-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-terminal-border">
        <div className="flex items-center gap-4">
          <Link
            href="/chronicle/shipments"
            className="text-terminal-muted hover:text-terminal-text transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <h1 className="text-lg font-medium text-terminal-text">
              Ask Chronicle
            </h1>
          </div>
        </div>
        <div className="text-xs text-terminal-muted">
          {currentMode !== 'chat' && (
            <span className="px-2 py-1 rounded bg-terminal-surface border border-terminal-border">
              Mode: {currentMode}
            </span>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {messages.length === 0 ? (
          <WelcomeScreen onQuickAction={handleQuickAction} />
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        {isLoading && messages[messages.length - 1]?.content === '' && (
          <div className="flex items-center gap-2 text-terminal-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions Bar */}
      {messages.length > 0 && (
        <div className="px-6 py-2 border-t border-terminal-border bg-terminal-surface/50">
          <div className="flex gap-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action)}
                disabled={isLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-terminal-border ${action.color} ${action.bgColor} transition-colors disabled:opacity-50`}
              >
                <action.icon className="h-3.5 w-3.5" />
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="px-6 py-4 border-t border-terminal-border bg-terminal-surface">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                currentMode === 'draft'
                  ? 'Describe what email you need (e.g., "Draft email to shipper about SI delay for booking 12345")'
                  : 'Ask about any shipment... (e.g., "What\'s happening with booking 12345?")'
              }
              rows={2}
              disabled={isLoading}
              className="w-full px-4 py-3 bg-terminal-bg border border-terminal-border rounded-lg text-terminal-text placeholder-terminal-muted resize-none focus:outline-none focus:border-amber-500/50 transition-colors disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </form>
        <div className="mt-2 text-xs text-terminal-muted">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}

// Welcome screen component
function WelcomeScreen({
  onQuickAction,
}: {
  onQuickAction: (action: (typeof QUICK_ACTIONS)[number]) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <div className="mb-6">
        <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center mb-4 mx-auto">
          <Sparkles className="h-8 w-8 text-amber-400" />
        </div>
        <h2 className="text-2xl font-semibold text-terminal-text mb-2">
          Chronicle AI
        </h2>
        <p className="text-terminal-muted max-w-md">
          Your intelligent freight operations assistant. Ask me anything about
          your shipments.
        </p>
      </div>

      <div className="space-y-4 w-full max-w-lg">
        <p className="text-sm text-terminal-muted">Quick actions:</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              onClick={() => onQuickAction(action)}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border border-terminal-border ${action.bgColor} transition-colors group`}
            >
              <action.icon className={`h-6 w-6 ${action.color}`} />
              <span className="text-sm text-terminal-muted group-hover:text-terminal-text transition-colors">
                {action.label}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-8 text-left space-y-2">
          <p className="text-sm text-terminal-muted">Try asking:</p>
          <div className="space-y-2">
            {[
              "What's happening with booking 37860708?",
              'Show me all critical shipments',
              'What shipped today?',
              'Draft an email about SI delay for booking 12345',
            ].map((example, i) => (
              <button
                key={i}
                onClick={() =>
                  onQuickAction({
                    id: 'example',
                    label: example,
                    icon: MessageSquare,
                    mode: 'chat',
                    prompt: example,
                    color: '',
                    bgColor: '',
                  })
                }
                className="block w-full text-left px-4 py-2 text-sm text-terminal-muted hover:text-terminal-text hover:bg-terminal-surface rounded-lg border border-transparent hover:border-terminal-border transition-colors"
              >
                <MessageSquare className="h-4 w-4 inline-block mr-2 opacity-50" />
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Message bubble component
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-amber-600/20 border border-amber-600/30 text-terminal-text'
            : 'bg-terminal-surface border border-terminal-border text-terminal-text'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              components={{
                p: ({ children }) => (
                  <p className="mb-2 last:mb-0">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-2 space-y-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-2 space-y-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-terminal-text">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="text-amber-400 font-semibold">
                    {children}
                  </strong>
                ),
                h1: ({ children }) => (
                  <h1 className="text-lg font-bold mb-2 text-terminal-text">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-base font-bold mb-2 text-terminal-text">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-bold mb-1 text-terminal-text">
                    {children}
                  </h3>
                ),
                code: ({ children }) => (
                  <code className="px-1 py-0.5 bg-terminal-bg rounded text-amber-300 text-xs">
                    {children}
                  </code>
                ),
                pre: ({ children }) => (
                  <pre className="p-3 bg-terminal-bg rounded-lg overflow-x-auto mb-2">
                    {children}
                  </pre>
                ),
              }}
            >
              {message.content || '...'}
            </ReactMarkdown>
          </div>
        )}
        <div className="mt-2 text-xs text-terminal-muted opacity-60">
          {message.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}
