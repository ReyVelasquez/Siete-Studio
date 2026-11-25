import React, { useEffect, useId } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { modalBackdropVariants, modalPanelVariants } from "@/config/animations";

export interface ModalProps {
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
  const headingId = useId();

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
          aria-labelledby={headingId}
        >
          {/* Tier 1 darkest monochrome anchor keeps scrim dark in both Light & Dark themes */}
          <motion.div
            variants={modalBackdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            className="fixed inset-0 bg-brand-950/65 backdrop-blur-sm"
          />

          <motion.div
            variants={modalPanelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-sticker border border-line-subtle bg-surface-card text-ink-primary shadow-elevated ${maxWidthClass}`}
          >
            <div className="flex items-start justify-between gap-4 border-b border-dashed border-line-subtle px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h2
                  id={headingId}
                  className="font-display text-lg font-bold tracking-tight text-ink-primary"
                >
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ventana"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent text-ink-muted transition-all duration-fast ease-studio hover:border-line-subtle hover:bg-surface-elevated hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-95"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
