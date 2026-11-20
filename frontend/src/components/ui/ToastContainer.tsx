import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToast } from "@/hooks/useToast";

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2.5 px-4 sm:px-0"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon =
            toast.variant === "success"
              ? CheckCircle2
              : toast.variant === "error"
              ? AlertCircle
              : Info;

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-3.5 shadow-elevated ${
                toast.variant === "error"
                  ? "border-brand-800 bg-brand-950 text-brand-50 dark:border-brand-300 dark:bg-brand-900"
                  : toast.variant === "success"
                  ? "border-brand-600 bg-surface-card text-ink-primary"
                  : "border-line-strong bg-surface-card text-ink-primary"
              }`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs opacity-85">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Cerrar notificación"
                className="rounded p-0.5 opacity-70 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
