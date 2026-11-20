import React, { useState } from "react";
import { motion } from "framer-motion";
import { Check, CheckCircle2, Copy, MessageCircle, PlusCircle } from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { StickerCard } from "@/components/ui/StickerCard";
import type { PublicOrderConfirmation } from "@/types/order";
import { formatDateTime } from "@/utils/date";

interface OrderConfirmationProps {
  confirmation: PublicOrderConfirmation;
  previewUrl: string | null;
  onCreateAnother: () => void;
}

export const OrderConfirmation: React.FC<OrderConfirmationProps> = ({
  confirmation,
  previewUrl,
  onCreateAnother,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(confirmation.order_number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked fallback
    }
  };

  const whatsappMessage = encodeURIComponent(
    `Hola ${THEME_CONFIG.brand.name}, acabo de registrar mi pedido ${confirmation.order_number} (${confirmation.quantity} stickers · ${confirmation.material} · ${confirmation.shape} ${confirmation.size_display}).`
  );
  const cleanSupportPhone = THEME_CONFIG.brand.whatsappSupport.replace(/\D/g, "");

  return (
    <motion.div
      variants={pageTransitionVariants}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-2xl"
    >
      <StickerCard dieCut padding="lg" className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sticker">
          <CheckCircle2 className="h-7 w-7" />
        </div>

        <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-widest text-ink-muted">
          Orden Confirmada
        </p>
        <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
          ¡Recibimos tu pedido de stickers!
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-secondary">
          {confirmation.message}
        </p>

        {/* Order Code Ticket */}
        <div className="mx-auto mt-6 inline-flex flex-wrap items-center justify-center gap-3 rounded-xl border border-line-strong bg-surface-elevated px-5 py-3.5">
          <div className="text-left">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-ink-muted">
              Número de Orden
            </span>
            <span className="font-mono text-xl font-extrabold tracking-wider text-ink-primary sm:text-2xl">
              {confirmation.order_number}
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            leftIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          >
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>

        {/* Summary Grid */}
        <div className="mt-7 grid grid-cols-1 gap-5 rounded-xl border border-line-subtle bg-surface-canvas/70 p-5 text-left sm:grid-cols-3">
          {previewUrl && (
            <div className="bg-transparency-grid flex items-center justify-center rounded-lg border border-line-subtle p-3">
              <img
                src={previewUrl}
                alt="Sticker enviado"
                className="max-h-28 max-w-full object-contain"
              />
            </div>
          )}

          <dl className={`grid grid-cols-2 gap-3 text-xs ${previewUrl ? "sm:col-span-2" : "sm:col-span-3"}`}>
            <div>
              <dt className="text-ink-muted">Referido</dt>
              <dd className="mt-0.5 font-bold text-ink-primary">{confirmation.referral_name}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Teléfono</dt>
              <dd className="mt-0.5 font-mono font-semibold text-ink-primary">
                {confirmation.phone}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Material</dt>
              <dd className="mt-0.5 font-semibold text-ink-primary">
                {confirmation.material}
                {confirmation.vinyl_gloss_mode ? ` (${confirmation.vinyl_gloss_mode})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Forma y Tamaño</dt>
              <dd className="mt-0.5 font-mono font-semibold text-ink-primary">
                {confirmation.shape} · {confirmation.size_display}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Cantidad</dt>
              <dd className="mt-0.5 font-mono font-bold text-ink-primary">
                {confirmation.quantity.toLocaleString()} uds.
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Estado actual</dt>
              <dd className="mt-1">
                <StickerBadge status={confirmation.status} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Recepción (servidor)</dt>
              <dd className="mt-0.5 font-mono text-[11px] font-medium text-ink-secondary">
                {formatDateTime(confirmation.received_at)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Entrega programada</dt>
              <dd className="mt-0.5 font-mono text-[11px] font-bold text-ink-primary">
                {formatDateTime(confirmation.delivery_datetime)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={`https://wa.me/${cleanSupportPhone}?text=${whatsappMessage}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-surface-card px-5 text-sm font-semibold text-ink-primary transition-colors hover:bg-surface-elevated sm:w-auto"
          >
            <MessageCircle className="h-4 w-4" />
            <span>Confirmar por WhatsApp</span>
          </a>
          <Button
            type="button"
            onClick={onCreateAnother}
            leftIcon={<PlusCircle className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            Enviar otro pedido
          </Button>
        </div>
      </StickerCard>
    </motion.div>
  );
};
