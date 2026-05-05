/**
 * DashboardAIChat.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-contained AI chat overlay for the Dashboard. Manages:
 *   • Chat messages + tRPC copilot.chat mutation
 *   • Voice recording / transcription
 *   • Action card rendering (proposal_created, proposal_sent, etc.)
 *   • Keyboard shortcut (Cmd/Ctrl+K) to open
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect, useCallback } from "react";
import DOMPurify from "dompurify";
import {
  Sparkles,
  X,
  Maximize2,
  Minimize2,
  Bot,
  User,
  Loader2,
  Send,
  Mic,
  MicOff,
  CheckCircle2,
  ExternalLink,
  Package,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getLogger } from "@/lib/logger";

const log = getLogger("DashboardAIChat");

// ── Types ────────────────────────────────────────────────────────────────────

interface ActionData {
  type: string;
  data: Record<string, unknown>;
}

interface ChatMessage {
  role: "ai" | "user" | "action";
  content: string;
  timestamp: string;
  actions?: ActionData[];
  executionLog?: string[];
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    role: "ai",
    content:
      "Hey! I'm your MergeTasks assistant. I can **execute tasks** for you — not just chat.\n\nTry things like:\n• \"Create a proposal for Acme Corp with 50 hoodies and 100 t-shirts\"\n• \"Search my product catalog for drinkware\"\n• \"Send proposal #5 to the client\"\n\nWhat would you like me to do?",
    timestamp: "Just now",
  },
];

const SUGGESTION_CHIPS = [
  "Create a proposal for Acme Corp with 50 hoodies",
  "Search products for drinkware",
  "Show me my clients",
  "Draft a proposal for Bright Labs",
];

// ── Component ─────────────────────────────────────────────────────────────────

interface DashboardAIChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DashboardAIChat({ open, onOpenChange }: DashboardAIChatProps) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<string | null>(null);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const chatMutation = trpc.copilot.chat.useMutation();
  const transcribeMutation = trpc.voice.transcribe.useMutation();

  // Auto-scroll on new messages
  useEffect(() => {
    if (open && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open, isTyping]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Keyboard shortcut Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
      if (e.key === "Escape" && open) {
        onOpenChange(false);
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  // Cleanup voice on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSend = async (text?: string) => {
    const msg = text || inputValue.trim();
    if (!msg || isTyping) return;

    const now = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    setMessages((prev) => [...prev, { role: "user", content: msg, timestamp: now }]);
    setInputValue("");
    setIsTyping(true);
    setExecutionStatus("Thinking...");

    try {
      const history = messages
        .filter((m) => m.role !== "action")
        .filter((_m, idx) => idx > 0)
        .map((m) => ({
          role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        }));

      const result = await chatMutation.mutateAsync({
        message: msg,
        conversationHistory: history,
        context: { page: "dashboard" },
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: result.reply,
          timestamp: "Just now",
          actions: result.actions as ActionData[] | undefined,
          executionLog: result.executionLog as string[] | undefined,
        },
      ]);

      if (result.actions && Array.isArray(result.actions)) {
        for (const action of result.actions as ActionData[]) {
          if (action.type === "navigate" && action.data?.path) {
            toast.info("Navigating...", {
              description:
                (action.data.reason as string) || `Going to ${action.data.path}`,
            });
            setTimeout(() => {
              navigate(action.data.path as string);
              onOpenChange(false);
            }, 1500);
          }
          if (action.type === "proposal_created") {
            toast.success("Proposal Created", {
              description: `${action.data.title} for ${action.data.clientName} — $${action.data.estimatedValue}`,
              action: {
                label: "View",
                onClick: () => navigate(`/proposals/${action.data.id}`),
              },
            });
          }
          if (action.type === "proposal_sent") {
            toast.success("Proposal Sent", {
              description: `Sent to ${action.data.sentTo} (${action.data.clientName})`,
            });
          }
          if (action.type === "webstore_created") {
            toast.success("Webstore Created", {
              description: `${action.data.name} for ${action.data.clientName}`,
              action: {
                label: "View",
                onClick: () => navigate(`/webstores/${action.data.storeId}`),
              },
            });
          }
          if (action.type === "products_assigned") {
            toast.success("Products Assigned", {
              description: `${action.data.assignedCount} products added to store`,
            });
          }
          if (action.type === "store_optimized") {
            toast.success("Store Optimized", {
              description: (action.data.tagline as string) || "AI-generated content applied",
            });
          }
        }
      }
    } catch (err: unknown) {
      const errMessage =
        (err instanceof Error ? err.message : "") ||
        (err as { data?: { message?: string } })?.data?.message ||
        "";
      let errorMsg = "Something went wrong. Please try again.";
      if (
        errMessage.includes("usage exhausted") ||
        errMessage.includes("quota") ||
        errMessage.includes("rate limit")
      ) {
        errorMsg =
          "The AI service has reached its usage limit. This is a temporary issue — please try again in a few minutes.";
      } else if (errMessage.includes("timeout") || errMessage.includes("ETIMEDOUT")) {
        errorMsg =
          "The request timed out. The AI service may be busy — please try again in a moment.";
      } else if (errMessage.includes("LLM") || errMessage.includes("AI service")) {
        errorMsg =
          "I'm having trouble connecting to the AI service right now. Please try again in a moment.";
      }
      setMessages((prev) => [...prev, { role: "ai", content: errorMsg, timestamp: "Just now" }]);
    } finally {
      setIsTyping(false);
      setExecutionStatus(null);
    }
  };

  // ── Voice ──────────────────────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/wav";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        setRecordingDuration(0);

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType.split(";")[0],
        });
        if (audioBlob.size < 1000) {
          setIsRecording(false);
          return;
        }

        setIsTranscribing(true);
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ""
            )
          );
          const result = await transcribeMutation.mutateAsync({
            audioBase64: base64,
            mimeType: mimeType.split(";")[0],
            language: "en",
          });
          if (result.text && result.text.trim()) handleSend(result.text.trim());
        } catch (err: unknown) {
          log.error("Transcription failed:", err);
          const now = new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          setMessages((prev) => [
            ...prev,
            {
              role: "ai",
              content:
                "Sorry, I couldn't understand the audio. Please try again or type your request.",
              timestamp: now,
            },
          ]);
        } finally {
          setIsTranscribing(false);
          setIsRecording(false);
        }
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch (err: unknown) {
      log.error("Mic access denied:", err);
      toast.error("Microphone access denied", {
        description: "Please allow microphone access in your browser settings.",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderMarkdown = (text: string) =>
    text.split("\n").map((line, i) => {
      const processed = DOMPurify.sanitize(
        line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
        { ALLOWED_TAGS: ["strong", "em", "span"], ALLOWED_ATTR: ["class"] }
      );
      if (line.startsWith("• ") || line.startsWith("- ")) {
        return (
          <div
            key={i}
            className="flex gap-2 ml-1"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(
                `<span class="text-mt-ink-4">•</span><span>${processed.slice(2)}</span>`,
                { ALLOWED_TAGS: ["span", "strong", "em"], ALLOWED_ATTR: ["class"] }
              ),
            }}
          />
        );
      }
      const numMatch = line.match(/^(\d+)\.\s/);
      if (numMatch) {
        return (
          <div
            key={i}
            className="flex gap-2 ml-1"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(
                `<span class="text-mt-ink-4 font-medium">${numMatch[1]}.</span><span>${processed.slice(numMatch[0].length)}</span>`,
                { ALLOWED_TAGS: ["span", "strong", "em"], ALLOWED_ATTR: ["class"] }
              ),
            }}
          />
        );
      }
      if (line === "") return <div key={i} className="h-2" />;
      return <div key={i} dangerouslySetInnerHTML={{ __html: processed }} />;
    });

  const renderActionCards = (actions: ActionData[]) => (
    <div className="mt-2 space-y-1.5">
      {actions.map((action, i) => {
        if (action.type === "proposal_created") {
          return (
            <div
              key={i}
              className="flex items-center gap-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg px-3 py-2"
            >
              <CheckCircle2 size={14} className="text-[#16A34A] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-[#166534]">Proposal Created</p>
                <p className="text-[11px] text-[#15803D]">
                  {action.data.title as string} — ${action.data.estimatedValue as string}
                </p>
              </div>
              <button
                onClick={() => {
                  navigate(`/proposals/${action.data.id}`);
                  onOpenChange(false);
                }}
                className="text-[11px] font-semibold text-[#16A34A] hover:underline flex items-center gap-0.5 shrink-0"
              >
                View <ExternalLink size={10} />
              </button>
            </div>
          );
        }
        if (action.type === "proposal_sent") {
          return (
            <div
              key={i}
              className="flex items-center gap-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-3 py-2"
            >
              <Send size={14} className="text-[#2563EB] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-[#1E40AF]">Proposal Sent</p>
                <p className="text-[11px] text-[#1D4ED8]">
                  Emailed to {action.data.sentTo as string}
                </p>
              </div>
            </div>
          );
        }
        if (action.type === "webstore_created") {
          return (
            <div
              key={i}
              className="flex items-center gap-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg px-3 py-2"
            >
              <Store size={14} className="text-[#16A34A] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-[#166534]">Webstore Created</p>
                <p className="text-[11px] text-[#15803D]">
                  {action.data.name as string} for {action.data.clientName as string}
                </p>
              </div>
              <button
                onClick={() => {
                  navigate(`/webstores/${action.data.storeId}`);
                  onOpenChange(false);
                }}
                className="text-[11px] font-semibold text-[#16A34A] hover:underline flex items-center gap-0.5 shrink-0"
              >
                View <ExternalLink size={10} />
              </button>
            </div>
          );
        }
        if (action.type === "products_assigned") {
          return (
            <div
              key={i}
              className="flex items-center gap-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-3 py-2"
            >
              <Package size={14} className="text-[#2563EB] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-[#1E40AF]">Products Assigned</p>
                <p className="text-[11px] text-[#1D4ED8]">
                  {action.data.assignedCount as number} products added to store
                </p>
              </div>
            </div>
          );
        }
        if (action.type === "store_optimized") {
          return (
            <div
              key={i}
              className="flex items-center gap-2 bg-[#FFF7ED] border border-[#FED7AA] rounded-lg px-3 py-2"
            >
              <Sparkles size={14} className="text-[#EA580C] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-[#9A3412]">Store Optimized</p>
                <p className="text-[11px] text-[#C2410C]">
                  {(action.data.tagline as string) || "AI content generated"}
                </p>
              </div>
            </div>
          );
        }
        if (action.type === "navigate") {
          return (
            <div
              key={i}
              className="flex items-center gap-2 bg-mt-brand-light border border-[#DDD6FE] rounded-lg px-3 py-2"
            >
              <ExternalLink size={14} className="text-primary shrink-0" />
              <p className="text-[12px] text-[#5B21B6]">
                Navigating to {action.data.path as string}
              </p>
            </div>
          );
        }
        return null;
      })}
    </div>
  );

  const renderExecutionLog = (execLog: string[]) => {
    if (!execLog || execLog.length === 0) return null;
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {execLog.map((step, i) => (
          <span
            key={i}
            className="text-[10px] text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 rounded-full border border-[#BBF7D0] font-medium"
          >
            {step}
          </span>
        ))}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40"
        onClick={() => {
          onOpenChange(false);
          setExpanded(false);
        }}
      />

      {/* Chat Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="MergeTasks AI Assistant"
        className={`fixed z-50 bg-white rounded-2xl shadow-2xl border border-mt-border flex flex-col transition-all duration-300 ${
          expanded
            ? "inset-2 sm:inset-6"
            : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] sm:w-[640px] h-[80vh] sm:h-[580px] max-h-[90vh]"
        }`}
        onKeyDown={(e) => {
          if (e.key === "Escape") { onOpenChange(false); setExpanded(false); }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#F0F0F0] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles size={14} className="text-white" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-mt-ink">MergeTasks AI</h3>
              <p className="text-[11px] text-[#16A34A] font-medium">
                {isTyping ? (
                  <span className="text-primary">{executionStatus || "Working..."}</span>
                ) : (
                  "Online · Ready to execute"
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              aria-label={expanded ? "Minimize AI Assistant" : "Maximize AI Assistant"}
              onClick={() => setExpanded(!expanded)}
              className="w-8 h-8 rounded-lg hover:bg-mt-surface-2 flex items-center justify-center text-mt-ink-3 transition-colors"
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              onClick={() => {
                onOpenChange(false);
                setExpanded(false);
              }}
              className="w-8 h-8 rounded-lg hover:bg-mt-surface-2 flex items-center justify-center text-mt-ink-3 transition-colors"
              aria-label="Close AI Assistant"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg, i) => (
            // Audit fix F14: use a composite key (role + timestamp + index) so
            // React can efficiently reconcile the list without relying on index alone.
            <div
              key={`${msg.role}-${msg.timestamp}-${i}`}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  msg.role === "ai" || msg.role === "action"
                    ? "bg-mt-brand-light"
                    : "bg-[#1A1A1A]"
                }`}
              >
                {msg.role === "ai" || msg.role === "action" ? (
                  <Bot size={13} className="text-primary" />
                ) : (
                  <User size={13} className="text-white" />
                )}
              </div>
              <div className={`max-w-[85%] ${msg.role === "user" ? "text-right" : ""}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
                    msg.role === "ai" || msg.role === "action"
                      ? "bg-[#F9F9F9] text-mt-ink"
                      : "bg-primary text-white"
                  }`}
                >
                  {msg.role === "user" ? msg.content : renderMarkdown(msg.content)}
                  {msg.executionLog &&
                    msg.executionLog.length > 0 &&
                    renderExecutionLog(msg.executionLog)}
                  {msg.actions && msg.actions.length > 0 && renderActionCards(msg.actions)}
                </div>
                <p className="text-[10px] text-mt-ink-4 mt-1 px-1">{msg.timestamp}</p>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-mt-brand-light flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={13} className="text-primary" />
              </div>
              <div className="bg-[#F9F9F9] rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="text-primary animate-spin" />
                  <span className="text-[12px] text-mt-ink-3 font-medium">
                    {executionStatus || "Thinking..."}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Suggestion chips */}
        {messages.length <= 1 && (
          <div className="px-5 pb-2 flex flex-wrap gap-2">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => handleSend(chip)}
                className="text-[12px] text-primary bg-mt-brand-light hover:bg-[#EDE9FE] px-3 py-1.5 rounded-full transition-colors font-medium"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <div className="px-4 py-2.5 bg-red-50 border-t border-red-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[13px] font-medium text-red-600">
                Recording... {formatDuration(recordingDuration)}
              </span>
            </div>
            <button
              onClick={stopRecording}
              className="px-3 py-1 text-[12px] font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
            >
              Stop & Send
            </button>
          </div>
        )}

        {/* Transcribing indicator */}
        {isTranscribing && (
          <div className="px-4 py-2.5 bg-[#F5F0FF] border-t border-mt-border flex items-center gap-2.5 shrink-0">
            <Loader2 size={14} className="text-primary animate-spin" />
            <span className="text-[13px] text-primary font-medium">
              Transcribing your voice...
            </span>
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-[#F0F0F0] shrink-0">
          <div className="flex items-center gap-2 bg-[#F9F9F9] rounded-xl px-4 py-2.5 border border-mt-border focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(101,75,249,0.06)] transition-all">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={
                isRecording
                  ? "Listening..."
                  : isTranscribing
                  ? "Transcribing..."
                  : isTyping
                  ? "Working on it..."
                  : "Tell me what to do..."
              }
              disabled={isTyping || isRecording || isTranscribing}
              className="flex-1 bg-transparent text-[13px] text-mt-ink placeholder:text-mt-ink-4 outline-none disabled:opacity-50"
            />
            <button
              aria-label={isRecording ? "Stop recording" : "Start voice input"}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing || isTyping}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 disabled:opacity-40 ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-mt-brand-light hover:bg-[#EDE9FE]"
              }`}
              title={isRecording ? "Stop recording" : "Start voice input"}
            >
              {isRecording ? (
                <MicOff size={13} className="text-white" />
              ) : (
                <Mic size={13} className={isTranscribing ? "text-mt-ink-4" : "text-primary"} />
              )}
            </button>
            <button
              aria-label="Send message"
              onClick={() => handleSend()}
              disabled={!inputValue.trim() || isTyping}
              className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white disabled:opacity-30 hover:bg-[#5338E0] transition-colors shrink-0"
            >
              <Send size={13} />
            </button>
          </div>
          <p className="text-[10px] text-mt-ink-4 text-center mt-2">
            MergeTasks AI executes real actions — proposals, emails, and voice commands.
          </p>
        </div>
      </div>
    </>
  );
}
