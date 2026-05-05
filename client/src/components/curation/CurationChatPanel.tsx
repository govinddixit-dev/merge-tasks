import { Bot, Send, X, Sparkles } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface CurationChatPanelProps {
  messages: ChatMessage[];
  chatInput: string;
  isTyping: boolean;
  onClose: () => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

export default function CurationChatPanel({
  messages,
  chatInput,
  isTyping,
  onClose,
  onInputChange,
  onSend,
}: CurationChatPanelProps) {
  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[400px] z-50 flex flex-col bg-[#0D0D10] shadow-xl"
      style={{ borderLeft: "1px solid #1E1E24" }}
    >
      <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #1E1E24" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary">
            <Bot size={14} color="#FFF" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-white">MergeTasks Copilot</h3>
            <p className="text-[10px] text-[#22C55E]">Online</p>
          </div>
        </div>
        <button className="p-1 hover:opacity-70 transition-opacity" onClick={onClose}>
          <X size={16} className="text-[#52525B]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] px-4 py-3 rounded-lg ${
              msg.role === "user" ? "bg-primary text-white" : "bg-[#16161A] text-[#E4E4E7]"
            }`}>
              <p className="text-[13px] leading-relaxed">{msg.text}</p>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-lg bg-[#16161A]">
              <div className="flex items-center gap-1.5">
                <Sparkles size={12} className="text-primary animate-pulse" />
                <span className="text-[13px] text-[#63636B]">Copilot is thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 py-4" style={{ borderTop: "1px solid #1E1E24" }}>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 px-4 py-2.5 text-[13px] outline-none rounded-lg bg-[#111114] border border-[#1E1E24] text-[#F4F4F5] placeholder-[#52525B]"
            placeholder="Ask about products, mockups, proposals..."
            value={chatInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSend()}
          />
          <button className="p-2.5 rounded-lg bg-primary hover:opacity-90 transition-opacity" onClick={onSend}>
            <Send size={14} color="#FFF" />
          </button>
        </div>
        <p className="text-[10px] mt-2 text-[#3F3F46]">Try: "Generate a mockup for Yeti Rambler" or "Find print products"</p>
      </div>
    </div>
  );
}
