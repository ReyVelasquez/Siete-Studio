import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToast } from "@/hooks/useToast";

const TOAST_VARIANT_STYLES = {
  error: {
    container: "border-state-critical-bg bg-state-critical-bg text-state-critical-ink",
    iconWrap: "bg-state-critical-ink/15 text-state-critical-ink",
    description: "text-state-critical-ink/85",
    closeButton: "text-state-critical-ink/75 hover:bg-state-critical-ink/15 hover:text-state-critical-ink",
    icon: AlertCircle,
  },
  success: {
    container: "border-line-diecut bg-surface-card text-ink-primary",
    iconWrap: "bg-state-positive-bg text-state-positive-ink",
    description: "text-ink-secondary",
    closeButton: "text-ink-muted hover:bg-surface-elevated hover:text-ink-primary",
    icon: CheckCircle2,
  },
  info: {
    container: "border-dashed border-line-strong bg-surface-card text-ink-primary",
    iconWrap: "bg-state-info-bg text-state-info-ink",
    description: "text-ink-secondary",
    closeButton: "text-ink-muted hover:bg-surface-elevated hover:text-ink-primary",
    icon: Info,
  },
} as const;

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2.5 px-4 sm:px-0"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const style = TOAST_VARIANT_STYLES[toast.variant] ?? TOAST_VARIANT_STYLES.info;
          const Icon = style.icon;

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              role={toast.variant === "error" ? "alert" : "status"}
              className={`sticker-badge pointer-events-auto flex items-start gap-3 rounded-sticker border-[1.5px] p-3.5 shadow-elevated transition-shadow duration-fast ease-studio hover:shadow-sticker-hover ${style.container}`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${style.iconWrap}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold tracking-tight">{toast.title}</p>
                {toast.description && (
                  <p className={`mt-0.5 text-xs ${style.description}`}>
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Cerrar notificación"
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${style.closeButton}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
