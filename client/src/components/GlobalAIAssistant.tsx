/*
 * Global Floating AI Assistant
 * - Appears on every dashboard page as a floating button in bottom-right
 * - Opens a slide-up chat panel
 * - Uses copilot tRPC procedure for real LLM responses
 * - Persists conversation across page navigation via state
 * - Voice input via MediaRecorder → S3 upload → Whisper transcription
 */

import { trpc } from "@/lib/trpc";
import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { ThinkingDots } from "@/components/motion/Skeletons";
import {
  Sparkles,
  X,
  Send,
  Minimize2,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Zap,
  AlertTriangle,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Streamdown } from "streamdown";
import POBulkPreviewCard from "@/components/po/POBulkPreviewCard";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { getLogger } from "@/lib/logger";

const log = getLogger("GlobalAIAssistant");

type ActionData = {
  type: string;
  data: Record<string, any>;
};

type PendingApproval = {
  id: number;
  toolName: string;
  summary: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  actions?: ActionData[];
  executionLog?: string[];
  awaitingApproval?: boolean;
  pendingApprovals?: PendingApproval[];
  /**
   * Optional structured attachment carried back from the copilot
   * (e.g. a `po_bulk_preview` card). Rendered inline below the markdown.
   */
  attachment?: { type: string; payload: unknown } | null;
};

// Module-level state to persist across navigation
let persistedMessages: Message[] = [];

export default function GlobalAIAssistant() {
  const prefersReducedMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>(persistedMessages);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [location] = useLocation();

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  // Waveform visualizer state
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveAnimRef = useRef<number | null>(null);
  const [waveHeights, setWaveHeights] = useState<number[]>([4, 4, 4, 4, 4, 4, 4]);

  const chatMutation = trpc.copilot.chat.useMutation();
  const transcribeMutation = trpc.voice.transcribe.useMutation();
  const approveMutation = trpc.actionApproval.approve.useMutation();
  const denyMutation = trpc.actionApproval.deny.useMutation();
  const { data: pendingData } = trpc.actionApproval.listPending.useQuery(undefined, {
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
  const pendingCount = pendingData?.length ?? 0;

  // Persist messages to module-level variable
  useEffect(() => {
    persistedMessages = messages;
  }, [messages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, chatMutation.isPending]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // Cleanup on unmount — release mic, cancel TTS, tear down audio graph,
  // stop any audio element. Without this, unmounting while recording or
  // speaking leaves the mic indicator on / TTS continuing in the background.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (waveAnimRef.current) cancelAnimationFrame(waveAnimRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
    };
  }, []);

  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || chatMutation.isPending) return;

      const userMsg: Message = { role: "user", content: text };
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      if (!textOverride) setInput("");

      try {
        const result = await chatMutation.mutateAsync({
          message: text,
          conversationHistory: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          context: { page: location },
        });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: result.reply,
            actions: result.actions as ActionData[] | undefined,
            executionLog: result.executionLog as string[] | undefined,
            awaitingApproval: result.awaitingApproval ?? false,
            pendingApprovals: result.pendingApprovals as PendingApproval[] | undefined,
            attachment: (result as { attachment?: { type: string; payload: unknown } | null }).attachment ?? null,
          },
        ]);

        if (result.reply) speakReplyRef.current(result.reply);

        // Handle actions
        if (result.actions && Array.isArray(result.actions)) {
          for (const action of result.actions as ActionData[]) {
            if (action.type === "navigate" && action.data?.path) {
              toast.info(`Navigating... — ${action.data.reason || `Going to ${action.data.path}`}`);
              setTimeout(() => {
                window.location.href = action.data.path;
              }, 1500);
            }
            if (action.type === "proposal_created") {
              toast.success("Proposal created", {
                description: `${action.data.title} — $${action.data.estimatedValue}`,
              });
            }
            if (action.type === "proposal_sent") {
              toast.success("Proposal sent", {
                description: `Sent to ${action.data.sentTo}`,
              });
            }
          }
        }
      } catch (err: unknown) {
        // Extract meaningful error message from tRPC/LLM errors
        let errorMsg = "Sorry, I couldn't process that. Please try again.";
        const errMessage =
          (err instanceof Error ? err.message : "") ||
          (typeof err === "object" && err !== null && "data" in err
            ? (err as { data?: { message?: string } }).data?.message || ""
            : "");
        if (errMessage.includes("usage exhausted") || errMessage.includes("quota") || errMessage.includes("rate limit")) {
          errorMsg = "The AI service has reached its usage limit. This is a temporary issue — please try again in a few minutes, or contact your administrator if it persists.";
        } else if (errMessage.includes("timeout") || errMessage.includes("ETIMEDOUT")) {
          errorMsg = "The request timed out. The AI service may be busy — please try again in a moment.";
        } else if (errMessage.includes("UNAUTHORIZED") || errMessage.includes("login")) {
          errorMsg = "Your session has expired. Please refresh the page and log in again.";
        } else if (errMessage.includes("Database") || errMessage.includes("database")) {
          errorMsg = "There was a database error. Please try again or contact support if the issue persists.";
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: errorMsg,
          },
        ]);
      }
    },
    [input, messages, chatMutation, location]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  //  Voice Recording 

  // Waveform animation loop
  const startWaveAnimation = (stream: MediaStream) => {
    try {
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const bars = 7;
      const animate = () => {
        analyser.getByteFrequencyData(dataArray);
        const heights: number[] = [];
        for (let i = 0; i < bars; i++) {
          const idx = Math.floor((i / bars) * dataArray.length);
          const val = dataArray[idx] / 255;
          heights.push(Math.max(4, Math.round(val * 28)));
        }
        setWaveHeights(heights);
        waveAnimRef.current = requestAnimationFrame(animate);
      };
      animate();
    } catch (_) {
      // analyser not critical
    }
  };

  const stopWaveAnimation = () => {
    if (waveAnimRef.current) cancelAnimationFrame(waveAnimRef.current);
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    setWaveHeights([4, 4, 4, 4, 4, 4, 4]);
  };

  const startRecording = async () => {
    // Mutex: if the assistant is speaking, cancel TTS before listening —
    // prevents isSpeaking + isRecording being true simultaneously.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    setIsSpeaking(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("MediaDevices API not available in this browser");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startWaveAnimation(stream);

      // Prefer webm, fall back to mp4 or wav
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
        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        // Clear timer
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        setRecordingDuration(0);

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType.split(";")[0],
        });

        // Don't process empty recordings
        if (audioBlob.size < 1000) {
          setIsRecording(false);
          return;
        }

        setIsTranscribing(true);

        try {
          // Convert to base64
          const arrayBuffer = await audioBlob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ""
            )
          );

          // Transcribe
          const result = await transcribeMutation.mutateAsync({
            audioBase64: base64,
            mimeType: mimeType.split(";")[0],
            language: "en",
          });

          if (result.text && result.text.trim()) {
            // Voice input → voice output: enable spoken replies for a
            // seamless two-way conversation, and send the transcription
            // as an ordinary user message.
            setVoiceEnabled(true);
            handleSend(result.text.trim());
          }
        } catch (err: unknown) {
          log.error("Transcription failed:", err);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Sorry, I couldn't understand the audio. Please try again or type your request.",
            },
          ]);
        } finally {
          setIsTranscribing(false);
          setIsRecording(false);
        }
      };

      recorder.start(250); // collect in 250ms chunks
      setIsRecording(true);
      setRecordingDuration(0);

      // Start duration timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err: unknown) {
      log.error("Mic access denied:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Microphone access was denied. Please allow microphone access in your browser settings to use voice input.",
        },
      ]);
    }
  };

  const stopRecording = () => {
    stopWaveAnimation();
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  // TTS via Web Speech API — no backend round-trip, instant playback
  const speakReply = useCallback((text: string, opts?: { force?: boolean }) => {
    if (!opts?.force && !voiceEnabled) return;
    if (!text.trim()) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const clean = text
      .replace(/#{1,6}\s/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`{1,3}[^`]*`{1,3}/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .trim()
      .slice(0, 1200);
    if (!clean) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(clean);
      utter.rate = 1.02;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      // Prefer an English neural/natural voice when available
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /Samantha|Google US English|Microsoft Aria|Microsoft Jenny/i.test(v.name)) ||
        voices.find((v) => v.lang?.toLowerCase().startsWith("en"));
      if (preferred) utter.voice = preferred;
      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => setIsSpeaking(false);
      utter.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utter);
    } catch {
      setIsSpeaking(false);
    }
  }, [voiceEnabled]);

  const speakReplyRef = useRef(speakReply);
  useEffect(() => {
    speakReplyRef.current = speakReply;
  }, [speakReply]);

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    setIsSpeaking(false);
  };

  // Stop any ongoing speech when the panel closes
  useEffect(() => {
    if (!isOpen && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [isOpen]);

  // Listen for globally-dispatched Daily Briefing events
  useEffect(() => {
    const handler = (e: Event) => {
      const summary = (e as CustomEvent<{ summary: string }>).detail?.summary;
      if (!summary) return;
      setIsOpen(true);
      setMessages((prev) => [...prev, { role: "assistant", content: summary }]);
      // Ensure voice is enabled for the briefing and speak it
      setVoiceEnabled(true);
      // Small delay so the panel is mounted before speech starts
      setTimeout(() => speakReplyRef.current(summary, { force: true }), 120);
    };
    window.addEventListener("mergetasks:briefing", handler);
    return () => window.removeEventListener("mergetasks:briefing", handler);
  }, []);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Get current page context for the greeting
  const getPageContext = () => {
    if (location.includes("webstores") || location.includes("store"))
      return "managing your stores";
    if (location.includes("proposal")) return "working on proposals";
    if (location.includes("curation") || location.includes("product"))
      return "curating products";
    if (location.includes("client")) return "managing clients";
    if (location.includes("report")) return "reviewing reports";
    if (location.includes("setting")) return "configuring settings";
    if (location.includes("proofing")) return "virtual proofing";
    return "your dashboard";
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-[60] w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
          style={{
            background: "linear-gradient(135deg, var(--mt-brand) 0%, #8B6FFF 100%)",
          }}
        >
          <Sparkles size={22} className="text-white" />
          {pendingCount > 0 ? (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
              {pendingCount}
            </span>
          ) : messages.length > 0 ? (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {messages.filter((m) => m.role === "assistant").length}
            </span>
          ) : null}
        </button>
      )}

      {/* Chat panel */}
      <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed z-[60] bg-white shadow-2xl border border-mt-border flex flex-col"
          style={{
            bottom: isExpanded ? 0 : 24,
            right: isExpanded ? 0 : 24,
            width: isExpanded ? "100vw" : "min(420px, calc(100vw - 48px))",
            height: isExpanded ? "100vh" : "min(600px, calc(100vh - 120px))",
            borderRadius: isExpanded ? 0 : 16,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3.5 shrink-0"
            style={{
              background: "linear-gradient(135deg, var(--mt-brand) 0%, #8B6FFF 100%)",
              borderRadius: isExpanded ? 0 : "16px 16px 0 0",
            }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <Sparkles size={16} className="text-white" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-white">
                  MergeTasks AI
                </h3>
                <p className="text-[11px] text-white/70">
                  Your intelligent assistant
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                {isExpanded ? (
                  <Minimize2 size={14} className="text-white/80" />
                ) : (
                  <Maximize2 size={14} className="text-white/80" />
                )}
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setIsExpanded(false);
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={14} className="text-white/80" />
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
            style={{ backgroundColor: "#FAFAFA" }}
          >
            {messages.length === 0 && (
              <div className="text-center py-8">
                <div
                  className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
                  style={{ backgroundColor: "#F0ECFF" }}
                >
                  <MessageSquare size={20} className="text-primary" />
                </div>
                <p className="text-[14px] font-medium text-mt-ink mb-1">
                  How can I help?
                </p>
                <p className="text-[12px] text-mt-ink-3 max-w-[260px] mx-auto">
                  I see you're {getPageContext()}. I can execute tasks for you — create proposals, search products, send emails, and more.
                </p>
                <p className="text-[11px] text-mt-ink-4 mt-2">
                  Type a message or tap the mic to speak
                </p>
                <div className="mt-4 space-y-2">
                  {[
                    "Create a proposal for Acme Corp with 50 hoodies",
                    "Search my product catalog for drinkware",
                    "Show me my clients",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion);
                        setTimeout(() => inputRef.current?.focus(), 50);
                      }}
                      className="block w-full text-left px-3 py-2 text-[12px] text-primary bg-white border border-mt-border rounded-lg hover:bg-[#F5F0FF] transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-white rounded-[14px] rounded-br-[4px]"
                      : "bg-white text-mt-ink border border-mt-border rounded-[14px] rounded-bl-[4px]"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <>
                      <Streamdown>{msg.content}</Streamdown>
                      {msg.attachment?.type === "po_bulk_preview" && (
                        <div className="mt-3">
                          <POBulkPreviewCard payload={msg.attachment.payload as React.ComponentProps<typeof POBulkPreviewCard>["payload"]} />
                        </div>
                      )}
                      {msg.executionLog && msg.executionLog.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {msg.executionLog.map((step, j) => (
                            <span key={j} className="text-[10px] text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 rounded-full border border-[#BBF7D0] font-medium">
                              {step}
                            </span>
                          ))}
                        </div>
                      )}
                      {msg.actions && msg.actions.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {msg.actions.map((action, j) => {
                            if (action.type === "proposal_created") {
                              return (
                                <div key={j} className="flex items-center gap-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg px-3 py-2">
                                  <CheckCircle2 size={13} className="text-[#16A34A] shrink-0" />
                                  <span className="text-[11px] text-[#166534] font-medium">Created: {action.data.title} — ${action.data.estimatedValue}</span>
                                </div>
                              );
                            }
                            if (action.type === "proposal_sent") {
                              return (
                                <div key={j} className="flex items-center gap-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-3 py-2">
                                  <Send size={13} className="text-[#2563EB] shrink-0" />
                                  <span className="text-[11px] text-[#1E40AF] font-medium">Sent to {action.data.sentTo}</span>
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}
                      {/* AI Approval Cards */}
                      {msg.pendingApprovals && msg.pendingApprovals.length > 0 && (
                        <div className="mt-2.5 space-y-2">
                          {msg.pendingApprovals.map((pa) => {
                            const isDestructive = pa.toolName.startsWith("delete_") || pa.toolName === "remove_user";
                            return (
                              <div
                                key={pa.id}
                                className={`rounded-lg border px-3 py-2.5 ${
                                  isDestructive
                                    ? "bg-red-50 border-red-200"
                                    : "bg-[#F8F7FF] border-[#E0DCFC]"
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  {isDestructive ? (
                                    <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
                                  ) : (
                                    <Zap size={14} className="text-primary mt-0.5 shrink-0" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-[12px] font-medium ${
                                      isDestructive ? "text-red-700" : "text-mt-ink"
                                    }`}>
                                      {pa.summary}
                                    </p>
                                    <p className="text-[10px] text-mt-ink-3 mt-0.5">
                                      Tool: {pa.toolName.replace(/_/g, " ")}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                  <button
                                    onClick={async () => {
                                      try {
                                        await approveMutation.mutateAsync({ pendingActionId: pa.id });
                                        toast.success(`Approved: ${pa.toolName.replace(/_/g, " ")}`);
                                        setMessages((prev) =>
                                          prev.map((m) =>
                                            m === msg
                                              ? {
                                                  ...m,
                                                  pendingApprovals: m.pendingApprovals?.filter((p) => p.id !== pa.id),
                                                  awaitingApproval: (m.pendingApprovals?.length ?? 0) > 1,
                                                }
                                              : m
                                          )
                                        );
                                      } catch (err: unknown) {
                                        toast.error(`Couldn't approve — please try again${err instanceof Error ? ` — ${err.message}` : ""}`);
                                      }
                                    }}
                                    disabled={approveMutation.isPending}
                                    className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                                      isDestructive
                                        ? "bg-red-500 text-white hover:bg-red-600"
                                        : "bg-primary text-white hover:bg-primary/90"
                                    } disabled:opacity-50`}
                                  >
                                    {approveMutation.isPending ? "..." : "Approve"}
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await denyMutation.mutateAsync({ pendingActionId: pa.id });
                                        toast.info(`Denied: ${pa.toolName.replace(/_/g, " ")}`);
                                        setMessages((prev) =>
                                          prev.map((m) =>
                                            m === msg
                                              ? {
                                                  ...m,
                                                  pendingApprovals: m.pendingApprovals?.filter((p) => p.id !== pa.id),
                                                  awaitingApproval: (m.pendingApprovals?.length ?? 0) > 1,
                                                }
                                              : m
                                          )
                                        );
                                      } catch (err: unknown) {
                                        toast.error(`Couldn't deny — please try again${err instanceof Error ? ` — ${err.message}` : ""}`);
                                      }
                                    }}
                                    disabled={denyMutation.isPending}
                                    className="px-3 py-1 text-[11px] font-medium text-mt-ink-3 bg-white border border-mt-border rounded-md hover:bg-mt-surface transition-colors disabled:opacity-50"
                                  >
                                    {denyMutation.isPending ? "..." : "Deny"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {chatMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-white border border-mt-border rounded-[14px] rounded-bl-[4px] px-4 py-3">
                  <ThinkingDots />
                </div>
              </div>
            )}
          </div>

          {/* Waveform recording overlay */}
          {isRecording && (
            <div
              className="px-4 py-3 border-t flex items-center justify-between shrink-0"
              style={{ background: "linear-gradient(135deg, #F5F0FF 0%, #EDE8FF 100%)", borderColor: "#DDD5FF" }}
            >
              <div className="flex items-center gap-3">
                {/* Live waveform bars */}
                <div className="flex items-end gap-[3px] h-8">
                  {waveHeights.map((h, i) => (
                    <div
                      key={i}
                      className="w-[3px] rounded-full transition-all duration-75"
                      style={{
                        height: h,
                        background: "var(--mt-brand)",
                        opacity: 0.7 + (h / 28) * 0.3,
                      }}
                    />
                  ))}
                </div>
                <span className="text-[12px] font-medium" style={{ color: "var(--mt-brand)" }}>
                  {formatDuration(recordingDuration)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-mt-ink-4">Release to send</span>
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ background: "var(--mt-brand)" }}
                />
              </div>
            </div>
          )}

          {/* Unified status pill: Listening / Thinking / Speaking */}
          <AnimatePresence>
            {(isTranscribing || chatMutation.isPending || isSpeaking) && !isRecording && (
              <motion.div
                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="px-4 py-2.5 border-t border-mt-border flex items-center gap-2.5 shrink-0"
                style={{ background: "var(--mt-brand-light)" }}
                aria-live="polite"
              >
                {isSpeaking ? (
                  <>
                    <div className="flex items-end gap-[3px] h-3.5" aria-hidden>
                      {[0, 1, 2, 3].map((i) => (
                        <motion.span
                          key={i}
                          className="w-[3px] rounded-full"
                          style={{ background: "var(--mt-brand)" }}
                          animate={prefersReducedMotion ? { height: 8 } : { height: [4, 14, 6, 12, 4] }}
                          transition={{
                            duration: 1.0,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: i * 0.1,
                          }}
                        />
                      ))}
                    </div>
                    <span className="text-[13px] font-medium" style={{ color: "var(--mt-brand)" }}>
                      Speaking…
                    </span>
                    <button
                      onClick={stopSpeaking}
                      className="ml-auto text-[12px] font-medium text-mt-ink-4 hover:text-primary transition-colors"
                    >
                      Stop
                    </button>
                  </>
                ) : isTranscribing ? (
                  <>
                    <Loader2 size={14} className="text-primary animate-spin" />
                    <span className="text-[13px] font-medium" style={{ color: "var(--mt-brand)" }}>
                      Listening…
                    </span>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: "var(--mt-brand)" }}
                          animate={prefersReducedMotion ? { opacity: 0.8 } : { opacity: [0.3, 1, 0.3] }}
                          transition={{
                            duration: 1.2,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: i * 0.2,
                          }}
                        />
                      ))}
                    </div>
                    <span className="text-[13px] font-medium" style={{ color: "var(--mt-brand)" }}>
                      Thinking…
                    </span>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input area */}
          <div
            className="px-3 pt-2 pb-1.5 border-t border-[#F0F0F0] bg-white shrink-0"
            style={{
              borderRadius: isExpanded ? 0 : "0 0 16px 16px",
            }}
          >
            <div className="flex items-end gap-2">
              {/* Hold-to-record mic button */}
              <button
                onMouseDown={!isTranscribing && !chatMutation.isPending ? startRecording : undefined}
                onMouseUp={isRecording ? stopRecording : undefined}
                onMouseLeave={isRecording ? stopRecording : undefined}
                onTouchStart={(e) => { e.preventDefault(); if (!isTranscribing && !chatMutation.isPending) startRecording(); }}
                onTouchEnd={(e) => { e.preventDefault(); if (isRecording) stopRecording(); }}
                disabled={isTranscribing || chatMutation.isPending}
                className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 disabled:opacity-40 select-none ${
                  isRecording
                    ? "scale-110 shadow-md"
                    : "bg-mt-surface-2 hover:bg-[#EBEBEB] active:scale-95"
                }`}
                style={isRecording ? { background: "linear-gradient(135deg, var(--mt-brand) 0%, #8B6FFF 100%)" } : {}}
                title="Hold to record"
              >
                {isRecording ? (
                  <Mic size={14} className="text-white" />
                ) : (
                  <Mic size={14} className={isTranscribing ? "text-mt-ink-4" : "text-primary"} />
                )}
              </button>

              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isRecording
                    ? "Recording..."
                    : isTranscribing
                      ? "Transcribing..."
                      : "Tell me what to do..."
                }
                rows={1}
                disabled={isRecording || isTranscribing}
                className="flex-1 resize-none text-[13px] bg-mt-surface-2 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-mt-ink-4 max-h-[100px] disabled:opacity-50"
                style={{ minHeight: 40 }}
              />

              {/* Voice output toggle */}
              <button
                onClick={() => { if (isSpeaking) stopSpeaking(); else setVoiceEnabled(v => !v); }}
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all bg-mt-surface-2 hover:bg-[#EBEBEB]"
                title={isSpeaking ? "Stop speaking" : voiceEnabled ? "Voice on — click to mute" : "Voice off — click to enable"}
              >
                {isSpeaking ? (
                  <Volume2 size={14} className="text-primary animate-pulse" />
                ) : voiceEnabled ? (
                  <Volume2 size={14} className="text-mt-ink-4" />
                ) : (
                  <VolumeX size={14} className="text-mt-ink-4/50" />
                )}
              </button>
              {/* Send button */}
              <button
                onClick={() => handleSend()}
                disabled={
                  !input.trim() ||
                  chatMutation.isPending ||
                  isRecording ||
                  isTranscribing
                }
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
                style={{
                  background:
                    input.trim() &&
                    !chatMutation.isPending &&
                    !isRecording &&
                    !isTranscribing
                      ? "linear-gradient(135deg, var(--mt-brand) 0%, #8B6FFF 100%)"
                      : "#E5E5E5",
                }}
              >
                <Send size={14} className="text-white" />
              </button>
            </div>
            {/* Compact AI data disclosure */}
            <p className="text-[9px] text-mt-ink-4/60 text-center mt-1.5 leading-none">
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="hover:text-mt-ink-3">Terms</a>
              {" · "}
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-mt-ink-3">Privacy</a>
            </p>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}
