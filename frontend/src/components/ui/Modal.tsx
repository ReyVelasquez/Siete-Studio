import React, { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { modalBackdropVariants, modalPanelVariants } from "@/config/animations";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  maxWidthClass = "max-w-3xl",
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-heading"
        >
          <motion.div
            variants={modalBackdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            className="fixed inset-0 bg-brand-950/60 backdrop-blur-sm"
          />

          <motion.div
            variants={modalPanelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-line-subtle bg-surface-card shadow-elevated ${maxWidthClass}`}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4 sm:px-6">
              <div>
                <h2
                  id="modal-heading"
                  className="font-display text-lg font-bold tracking-tight text-ink-primary"
                >
                  {title}
                </h2>
                {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ventana"
                className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-elevated hover:text-ink-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
