import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App-wide toast surface.
 *
 * Design: a single slim, minimal top-center notification bar (one at a time,
 * no icons, no description, auto-dismiss). The colored left border carries
 * the semantic meaning; the copy carries the content.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      duration={3000}
      visibleToasts={1}
      gap={8}
      offset={16}
      toastOptions={{
        style: {
          background: "white",
          border: "1px solid #E5E5E5",
          borderRadius: "10px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          fontSize: "13px",
          fontWeight: 500,
          color: "#111111",
          padding: "12px 16px",
          maxWidth: "420px",
          minHeight: "44px",
        },
        classNames: {
          // Semantic 3 px left accent per type. The rest of the chrome comes
          // from the style block above so every type shares the same base.
          success: "border-l-[3px] border-l-[#16A34A]",
          error: "border-l-[3px] border-l-[#DC2626]",
          warning: "border-l-[3px] border-l-[#D97706]",
          info: "border-l-[3px] border-l-[#6B7280]",
          // Hide the default leading icon and any description/subtitle so the
          // bar always renders as a single line of copy.
          icon: "!hidden",
          description: "!hidden",
          closeButton: "!hidden",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
