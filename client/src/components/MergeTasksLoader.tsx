/**
 * MergeTasksLoader — Branded loading animation
 * 
 * Inspired by Stripe's loading style: subtle, fast, premium.
 * The animation shows stacked document/file layers that shuffle through,
 * representing the MergeTasks logo concept (multiple files merging).
 * 
 * Variants:
 * - "page" — full-page centered loader (for route transitions, auth checks)
 * - "inline" — compact inline loader (for data loading within a page section)
 */

interface MergeTasksLoaderProps {
  variant?: "page" | "inline";
  message?: string;
}

export function MergeTasksLoader({ variant = "page", message }: MergeTasksLoaderProps) {
  if (variant === "inline") {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <FileStackAnimation size={32} />
          {message && <p className="text-[13px] text-mt-ink-3 animate-fade-in">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mt-surface flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <FileStackAnimation size={40} />
        {message && <p className="text-[13px] text-mt-ink-3 animate-fade-in">{message}</p>}
      </div>
    </div>
  );
}

/**
 * FileStackAnimation — The core animation component.
 * 
 * Three document layers that cycle through a shuffle motion:
 * - Back layer slides up and fades in
 * - Middle layer stays centered
 * - Front layer slides down and fades out
 * Then they swap positions in a continuous loop.
 * 
 * Think: a deck of cards being dealt, but with document icons.
 */
function FileStackAnimation({ size = 40 }: { size?: number }) {
  const docW = size;
  const docH = size * 1.25;
  const cornerR = size * 0.1;
  const foldSize = size * 0.25;

  return (
    <div className="relative" style={{ width: docW + 12, height: docH + 12 }}>
      <style>{`
        @keyframes mergetasks-shuffle {
          0%, 100% {
            transform: translateY(0px) scale(1);
            opacity: 1;
          }
          15% {
            transform: translateY(-${size * 0.15}px) scale(1.02);
            opacity: 1;
          }
          30% {
            transform: translateY(-${size * 0.08}px) scale(0.98);
            opacity: 0.7;
          }
          50% {
            transform: translateY(${size * 0.05}px) scale(0.96);
            opacity: 0.5;
          }
          70% {
            transform: translateY(${size * 0.02}px) scale(0.98);
            opacity: 0.7;
          }
          85% {
            transform: translateY(-${size * 0.03}px) scale(1);
            opacity: 0.9;
          }
        }

        @keyframes mergetasks-shuffle-mid {
          0%, 100% {
            transform: translateY(0px) translateX(0px) scale(0.95);
            opacity: 0.6;
          }
          20% {
            transform: translateY(${size * 0.04}px) translateX(1px) scale(0.96);
            opacity: 0.7;
          }
          40% {
            transform: translateY(${size * 0.1}px) translateX(0px) scale(1);
            opacity: 1;
          }
          60% {
            transform: translateY(${size * 0.06}px) translateX(-1px) scale(1.01);
            opacity: 0.9;
          }
          80% {
            transform: translateY(${size * 0.02}px) translateX(0px) scale(0.97);
            opacity: 0.7;
          }
        }

        @keyframes mergetasks-shuffle-back {
          0%, 100% {
            transform: translateY(0px) scale(0.9);
            opacity: 0.3;
          }
          25% {
            transform: translateY(${size * 0.08}px) scale(0.92);
            opacity: 0.4;
          }
          50% {
            transform: translateY(${size * 0.15}px) scale(0.95);
            opacity: 0.5;
          }
          75% {
            transform: translateY(${size * 0.1}px) scale(0.93);
            opacity: 0.4;
          }
        }

        @keyframes mergetasks-line-pulse {
          0%, 100% { opacity: 0.15; width: 60%; }
          50% { opacity: 0.35; width: 75%; }
        }

        @keyframes mergetasks-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .animate-fade-in {
          animation: mergetasks-fade-in 0.4s ease-out 0.3s both;
        }
      `}</style>

      {/* Back document (deepest layer) */}
      <svg
        width={docW}
        height={docH}
        viewBox={`0 0 ${docW} ${docH}`}
        className="absolute"
        style={{
          top: 6,
          left: 6,
          animation: "mergetasks-shuffle-back 2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        }}
      >
        <path
          d={`M${cornerR},0 H${docW - foldSize} L${docW},${foldSize} V${docH - cornerR} Q${docW},${docH} ${docW - cornerR},${docH} H${cornerR} Q0,${docH} 0,${docH - cornerR} V${cornerR} Q0,0 ${cornerR},0 Z`}
          fill="#E8E4FD"
          stroke="#D4CEFB"
          strokeWidth="0.5"
        />
      </svg>

      {/* Middle document */}
      <svg
        width={docW}
        height={docH}
        viewBox={`0 0 ${docW} ${docH}`}
        className="absolute"
        style={{
          top: 3,
          left: 3,
          animation: "mergetasks-shuffle-mid 2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
          animationDelay: "0.15s",
        }}
      >
        <path
          d={`M${cornerR},0 H${docW - foldSize} L${docW},${foldSize} V${docH - cornerR} Q${docW},${docH} ${docW - cornerR},${docH} H${cornerR} Q0,${docH} 0,${docH - cornerR} V${cornerR} Q0,0 ${cornerR},0 Z`}
          fill="#D4CEFB"
          stroke="#B8AFFA"
          strokeWidth="0.5"
        />
        {/* Content lines */}
        <rect x={docW * 0.18} y={docH * 0.35} width={docW * 0.5} height={1.5} rx="0.75" fill="#A594FD" opacity="0.3" />
        <rect x={docW * 0.18} y={docH * 0.5} width={docW * 0.35} height={1.5} rx="0.75" fill="#A594FD" opacity="0.2" />
      </svg>

      {/* Front document (top layer) */}
      <svg
        width={docW}
        height={docH}
        viewBox={`0 0 ${docW} ${docH}`}
        className="absolute"
        style={{
          top: 0,
          left: 0,
          animation: "mergetasks-shuffle 2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
          animationDelay: "0.3s",
        }}
      >
        {/* Document body */}
        <path
          d={`M${cornerR},0 H${docW - foldSize} L${docW},${foldSize} V${docH - cornerR} Q${docW},${docH} ${docW - cornerR},${docH} H${cornerR} Q0,${docH} 0,${docH - cornerR} V${cornerR} Q0,0 ${cornerR},0 Z`}
          fill="white"
          stroke="var(--mt-brand)"
          strokeWidth="1"
          strokeOpacity="0.4"
        />
        {/* Corner fold */}
        <path
          d={`M${docW - foldSize},0 V${foldSize - cornerR * 0.5} Q${docW - foldSize},${foldSize} ${docW - foldSize + cornerR * 0.5},${foldSize} H${docW}`}
          fill="#F5F3FF"
          stroke="var(--mt-brand)"
          strokeWidth="0.5"
          strokeOpacity="0.3"
        />
        {/* Content lines with pulse */}
        <rect x={docW * 0.18} y={docH * 0.3} width={docW * 0.55} height={2} rx="1" fill="var(--mt-brand)" opacity="0.25">
          <animate attributeName="opacity" values="0.15;0.35;0.15" dur="2s" repeatCount="indefinite" />
        </rect>
        <rect x={docW * 0.18} y={docH * 0.42} width={docW * 0.45} height={1.5} rx="0.75" fill="var(--mt-brand)" opacity="0.15">
          <animate attributeName="opacity" values="0.1;0.25;0.1" dur="2s" repeatCount="indefinite" begin="0.3s" />
        </rect>
        <rect x={docW * 0.18} y={docH * 0.52} width={docW * 0.38} height={1.5} rx="0.75" fill="var(--mt-brand)" opacity="0.12">
          <animate attributeName="opacity" values="0.08;0.2;0.08" dur="2s" repeatCount="indefinite" begin="0.6s" />
        </rect>
        {/* Small checkbox/checkmark hint */}
        <rect x={docW * 0.18} y={docH * 0.68} width={docW * 0.08} height={docW * 0.08} rx="1" fill="none" stroke="var(--mt-brand)" strokeWidth="0.8" opacity="0.2" />
        <rect x={docW * 0.32} y={docH * 0.69} width={docW * 0.3} height={1.5} rx="0.75" fill="var(--mt-brand)" opacity="0.1" />
        <rect x={docW * 0.18} y={docH * 0.8} width={docW * 0.08} height={docW * 0.08} rx="1" fill="none" stroke="var(--mt-brand)" strokeWidth="0.8" opacity="0.2" />
        <rect x={docW * 0.32} y={docH * 0.81} width={docW * 0.25} height={1.5} rx="0.75" fill="var(--mt-brand)" opacity="0.1" />
      </svg>
    </div>
  );
}

export default MergeTasksLoader;
