import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Globe, Calendar, MapPin, Languages, Search, Loader2, ChevronDown, ChevronUp, Navigation } from 'lucide-react';
import type { ItineraryItem, MapPin as MapPinType } from '../App';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
  streaming?: boolean;
}

interface ToolCall {
  name: string;
  args: any;
  result?: any;
  status: 'running' | 'done' | 'error';
}

interface AgentChatProps {
  itinerary: ItineraryItem[];
  pins: MapPinType[];
  onSideEffect: (effect: any) => void;
}

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  read_itinerary:        { icon: <Calendar className="w-3 h-3" />, label: 'Reading itinerary',    color: 'text-blue-400' },
  add_itinerary_item:    { icon: <Calendar className="w-3 h-3" />, label: 'Adding to itinerary', color: 'text-emerald-400' },
  update_itinerary_item: { icon: <Calendar className="w-3 h-3" />, label: 'Updating itinerary',  color: 'text-amber-400' },
  delete_itinerary_item: { icon: <Calendar className="w-3 h-3" />, label: 'Removing from itinerary', color: 'text-red-400' },
  get_map_pins:          { icon: <MapPin className="w-3 h-3" />,  label: 'Checking map pins',   color: 'text-purple-400' },
  add_map_pin:           { icon: <MapPin className="w-3 h-3" />,  label: 'Adding map pin',      color: 'text-purple-400' },
  navigate_map:          { icon: <Navigation className="w-3 h-3" />, label: 'Navigating map',  color: 'text-cyan-400' },
  browse_web:            { icon: <Globe className="w-3 h-3" />,   label: 'Browsing web',        color: 'text-sky-400' },
  browser_use:           { icon: <Globe className="w-3 h-3" />,   label: 'Browser',             color: 'text-cyan-400' },
  search_knowledge:      { icon: <Search className="w-3 h-3" />,  label: 'Researching',         color: 'text-indigo-400' },
  translate:             { icon: <Languages className="w-3 h-3" />, label: 'Translating',       color: 'text-rose-400' },
};

const QUICK_PROMPTS = [
  { label: '🗺️ Show Cerritos on map', prompt: 'Navigate the map to Cerritos beach' },
  { label: '📅 Show my itinerary', prompt: 'Read my current itinerary and summarize it day by day' },
  { label: '🏄 Add surf lesson', prompt: 'Add a morning surf lesson at Cerritos Surf Academy on Saturday June 20 at 8:30 AM' },
  { label: '🌮 Best tacos', prompt: 'What are the best taco spots near Cerritos and Cabo? Add the top ones to the map.' },
  { label: '🚗 Airport rides', prompt: 'What are my options for getting from SJD airport to Cerritos?' },
  { label: '🌊 Check surf report', prompt: 'Browse surfline or magicseaweed and tell me the surf conditions for Cerritos this week' },
  { label: '🔤 Translate phrase', prompt: 'Translate "Where is the surf school?" and "How much does it cost?" to Spanish' },
  { label: '🗑️ Clear Day 2', prompt: 'Remove everything from June 20 in my itinerary' },
];

let msgIdCounter = 0;
function newId() { return `msg-${++msgIdCounter}-${Date.now()}`; }

export default function AgentChat({ onSideEffect }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: newId(),
      role: 'assistant',
      text: "Hey! I'm your Baja surf trip concierge. I can manage your itinerary, control the map, research surf conditions, translate Spanish, and answer anything about Cerritos & Cabo.\n\nTry asking me to show your itinerary, add an activity, find the best tacos, or navigate to a spot.",
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Keep conversation history for multi-turn context
  const historyRef = useRef<Array<{ role: string; text: string }>>([]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput('');

    const userMsg: Message = { id: newId(), role: 'user', text: trimmed };
    setMessages(prev => [...prev, userMsg]);
    historyRef.current = [...historyRef.current, { role: 'user', text: trimmed }];

    const assistantId = newId();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', text: '', toolCalls: [], streaming: true };
    setMessages(prev => [...prev, assistantMsg]);
    setLoading(true);

    try {
      const resp = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyRef.current }),
      });

      if (!resp.body) throw new Error('No response body');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE messages are separated by blank lines
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const lines = chunk.split('\n');
          let event = '';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          try {
            const payload = JSON.parse(data);

            if (event === 'text') {
              fullText += payload.text || '';
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, text: fullText } : m
              ));
            } else if (event === 'tool_start') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, toolCalls: [...(m.toolCalls || []), { name: payload.name, args: payload.args, status: 'running' as const }] }
                  : m
              ));
            } else if (event === 'tool_done') {
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantId) return m;
                const tcs = [...(m.toolCalls || [])];
                for (let i = tcs.length - 1; i >= 0; i--) {
                  if (tcs[i].name === payload.name && tcs[i].status === 'running') {
                    tcs[i] = { ...tcs[i], result: payload.result, status: 'done' as const };
                    break;
                  }
                }
                return { ...m, toolCalls: tcs };
              }));
            } else if (event === 'done') {
              for (const effect of (payload.sideEffects || [])) {
                onSideEffect(effect);
              }
            }
          } catch {}
        }
      }

      // Finalize
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, streaming: false, text: fullText || m.text } : m
      ));
      historyRef.current = [...historyRef.current, { role: 'assistant', text: fullText }];
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, streaming: false, text: 'Connection error — is the server running?' }
          : m
      ));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const toggleTool = (key: string) => {
    setExpandedTools(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>

            {/* Avatar */}
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
              msg.role === 'user'
                ? 'bg-[#e8552d]'
                : 'bg-white/10 border border-white/10'
            }`}>
              {msg.role === 'user'
                ? <User className="w-3.5 h-3.5 text-white" />
                : <Bot className="w-3.5 h-3.5 text-white/70" />
              }
            </div>

            <div className={`flex flex-col gap-1.5 max-w-[88%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>

              {/* Text bubble — or typing dots if streaming with no text yet */}
              {msg.role === 'assistant' && msg.streaming && !msg.text ? (
                <div className="bg-white/8 border border-white/8 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                  <span className="typing-dot w-1.5 h-1.5 bg-white/40 rounded-full" />
                  <span className="typing-dot w-1.5 h-1.5 bg-white/40 rounded-full" />
                  <span className="typing-dot w-1.5 h-1.5 bg-white/40 rounded-full" />
                </div>
              ) : msg.text ? (
                <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#e8552d] text-white rounded-tr-sm'
                    : 'bg-white/8 text-white/90 rounded-tl-sm border border-white/8'
                }`}>
                  <MessageText text={msg.text} streaming={msg.streaming} />
                </div>
              ) : null}

              {/* Tool calls */}
              {msg.toolCalls?.map((tc, ti) => {
                const meta = TOOL_META[tc.name] || { icon: <Search className="w-3 h-3" />, label: tc.name, color: 'text-white/50' };
                const key = `${msg.id}-${ti}`;
                const expanded = expandedTools.has(key);

                return (
                  <button
                    key={ti}
                    onClick={() => toggleTool(key)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/8 rounded-lg text-[11px] transition-all group text-left"
                  >
                    <span className={`${meta.color} ${tc.status === 'running' ? 'tool-running' : ''}`}>
                      {tc.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : meta.icon}
                    </span>
                    <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                    {tc.status === 'running' && <span className="text-white/30 text-[10px]">running…</span>}
                    {tc.status === 'done' && (
                      <>
                        <ToolSummary name={tc.name} result={tc.result} />
                        {expanded
                          ? <ChevronUp className="w-3 h-3 text-white/30 ml-auto" />
                          : <ChevronDown className="w-3 h-3 text-white/30 ml-auto" />
                        }
                      </>
                    )}
                    {expanded && tc.result && (
                      <div className="w-full mt-1 pt-1 border-t border-white/10 text-white/50 text-[10px] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {JSON.stringify(tc.result, null, 2).slice(0, 600)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      <div className="px-3 py-2 flex gap-1.5 overflow-x-auto shrink-0">
        {QUICK_PROMPTS.map((qp, i) => (
          <button
            key={i}
            onClick={() => sendMessage(qp.prompt)}
            disabled={loading}
            className="shrink-0 px-2.5 py-1.5 bg-white/6 hover:bg-white/12 border border-white/10 rounded-full text-[11px] font-medium text-white/60 hover:text-white/90 transition-all disabled:opacity-30 whitespace-nowrap"
          >
            {qp.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="px-3 pb-3 shrink-0">
        <div className="flex gap-2 items-end bg-white/8 border border-white/12 rounded-2xl px-3 py-2 focus-within:border-white/25 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything about the trip…"
            disabled={loading}
            rows={1}
            className="flex-1 bg-transparent text-[13px] text-white placeholder-white/30 outline-none resize-none max-h-32 leading-relaxed disabled:opacity-50"
            style={{ fieldSizing: 'content' } as any}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="shrink-0 w-8 h-8 bg-[#e8552d] hover:bg-[#f06040] disabled:opacity-30 text-white rounded-xl flex items-center justify-center transition-all mb-0.5"
          >
            {loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Send className="w-3.5 h-3.5" />
            }
          </button>
        </div>
        <p className="text-[10px] text-white/20 text-center mt-1.5">↵ send · Shift+↵ newline</p>
      </div>
    </div>
  );
}

// Render markdown-ish text with line breaks
function MessageText({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split('\n');
  return (
    <span>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {line}
        </span>
      ))}
      {streaming && <span className="inline-block w-1.5 h-3 bg-white/60 ml-0.5 animate-pulse rounded-sm" />}
    </span>
  );
}

// Short summary of tool result
function ToolSummary({ name, result }: { name: string; result: any }) {
  if (!result) return null;
  if (result.error) return <span className="text-red-400 text-[10px]">Error: {result.error}</span>;

  switch (name) {
    case 'read_itinerary':
      return <span className="text-white/40 text-[10px]">{result.count} items</span>;
    case 'add_itinerary_item':
      return <span className="text-emerald-400 text-[10px]">✓ {result.item?.title?.slice(0, 25)}</span>;
    case 'update_itinerary_item':
      return <span className="text-amber-400 text-[10px]">✓ Updated</span>;
    case 'delete_itinerary_item':
      return <span className="text-red-400 text-[10px]">✓ Removed</span>;
    case 'add_map_pin':
      return <span className="text-purple-400 text-[10px]">✓ {result.pin?.title?.slice(0, 20)}</span>;
    case 'navigate_map':
      return <span className="text-cyan-400 text-[10px]">→ {result.label || `${result.lat?.toFixed(2)}, ${result.lng?.toFixed(2)}`}</span>;
    case 'browse_web':
      return <span className="text-white/40 text-[10px]">{result.url?.replace('https://','').slice(0,30)}</span>;
    case 'browser_use':
      return <span className="text-cyan-400 text-[10px]">{result.action} {result.url?.replace('https://','').slice(0,25) || ''}</span>;
    case 'search_knowledge':
      return <span className="text-white/40 text-[10px]">{result.answer?.slice(0, 40)}…</span>;
    case 'translate':
      return <span className="text-white/40 text-[10px]">{result.translatedText?.slice(0, 30)}</span>;
    case 'get_map_pins':
      return <span className="text-white/40 text-[10px]">{result.count} pins</span>;
    default:
      return null;
  }
}

// Helper: detect the SSE event type from context
// (kept for reference — currently unused)
function _detectEvent(dataLine: string, allLines: string[]): string {
  const idx = allLines.indexOf(dataLine);
  if (idx > 0) {
    const prev = allLines[idx - 1];
    if (prev?.startsWith('event: ')) return prev.slice(7).trim();
  }
  return '';
}
