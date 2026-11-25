import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Copy,
  Layers,
  MessageCircle,
  PlusCircle,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { StickerCard } from "@/components/ui/StickerCard";
import type { OrderDesignItemResponse, PublicOrderConfirmation } from "@/types/order";
import { formatDateTime } from "@/utils/date";

interface OrderConfirmationProps {
  confirmation: PublicOrderConfirmation;
  previewUrls: (string | null)[];
  onCreateAnother: () => void;
}

export const OrderConfirmation: React.FC<OrderConfirmationProps> = ({
  confirmation,
  previewUrls,
  onCreateAnother,
}) => {
  const [copied, setCopied] = useState(false);

  const items: OrderDesignItemResponse[] =
    confirmation.items && confirmation.items.length > 0
      ? confirmation.items
      : [
          {
            id: confirmation.id,
            position: 1,
            material: confirmation.material,
            vinyl_gloss_mode: confirmation.vinyl_gloss_mode,
            shape: confirmation.shape,
            diameter_cm: confirmation.diameter_cm,
            dimensions: confirmation.dimensions,
            size_display: confirmation.size_display,
            quantity: confirmation.quantity,
            image: {
              storage_path: "",
              safe_filename: "",
              original_filename: "sticker",
              content_type: "image/png",
              size_bytes: 0,
            },
          },
        ];

  const itemsCount = confirmation.items_count ?? items.length;
  const totalQuantity =
    confirmation.total_quantity ?? items.reduce((acc, item) => acc + item.quantity, 0);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(confirmation.order_number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked fallback
    }
  };

  const whatsappSummary =
    itemsCount > 1
      ? `${itemsCount} diseños · ${totalQuantity.toLocaleString()} stickers en total`
      : `${items[0].quantity} stickers · ${items[0].material} · ${items[0].shape} ${items[0].size_display}`;

  const whatsappMessage = encodeURIComponent(
    `Hola ${THEME_CONFIG.brand.name}, acabo de registrar mi pedido ${confirmation.order_number} (${whatsappSummary}).`
  );
  const cleanSupportPhone = THEME_CONFIG.brand.whatsappSupport.replace(/\D/g, "");

  return (
    <motion.div
      variants={pageTransitionVariants}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-3xl"
    >
      <StickerCard
        dieCut
        registrationMarks
        tone="featured"
        padding="lg"
        className="text-center"
      >
        <div className="sticker-badge mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </div>

        <p className="mt-4 font-mono text-xs font-bold uppercase tracking-widest text-accent">
          Orden Confirmada
        </p>
        <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
          ¡Recibimos tu pedido de stickers!
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-secondary">
          {confirmation.message}
        </p>

        {/* Order Code Ticket */}
        <div className="mx-auto mt-6 inline-flex flex-wrap items-center justify-center gap-3 rounded-sticker border border-dashed border-line-diecut bg-accent-soft/55 px-5 py-3.5 shadow-xs">
          <div className="text-left">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-ink-muted">
              Número de Orden
            </span>
            <span className="font-mono text-xl font-extrabold tracking-wider tabular-nums text-ink-primary sm:text-2xl">
              {confirmation.order_number}
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            leftIcon={
              copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />
            }
          >
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>

        {/* Customer & Delivery Header Summary */}
        <dl className="mt-7 grid grid-cols-2 gap-4 rounded-sticker border border-line-subtle bg-surface-canvas/75 p-5 text-left text-xs sm:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Referido</dt>
            <dd className="mt-0.5 font-bold text-ink-primary">{confirmation.referral_name}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Teléfono</dt>
            <dd className="mt-0.5 font-mono font-semibold tabular-nums text-ink-primary">
              {confirmation.phone}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Entrega programada</dt>
            <dd className="mt-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-primary">
              {formatDateTime(confirmation.delivery_datetime)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Estado actual</dt>
            <dd className="mt-1">
              <StickerBadge status={confirmation.status} size="sm" />
            </dd>
          </div>
        </dl>

        {/* Designs Breakdown List */}
        <div className="mt-5 rounded-sticker border border-line-subtle bg-surface-canvas/75 p-5 text-left">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-line-subtle pb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-accent" aria-hidden="true" />
              <h3 className="font-display text-sm font-extrabold tracking-tight text-ink-primary">
                Detalle de {itemsCount === 1 ? "Diseño" : `Diseños (${itemsCount})`}
              </h3>
            </div>
            <span className="rounded-full border border-dashed border-line-diecut/70 bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-primary">
              Total: {totalQuantity.toLocaleString()} uds.
            </span>
          </div>

          <ul className="space-y-3">
            {items.map((item, idx) => {
              const thumbUrl = previewUrls[idx] ?? null;
              return (
                <li
                  key={item.id || `confirmed-item-${idx}`}
                  className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface-card p-3.5 sm:flex-row sm:items-center"
                >
                  {thumbUrl && (
                    <div className="bg-transparency-grid sticker-badge flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-line-diecut/65 p-1.5">
                      <img
                        src={thumbUrl}
                        alt={`Sticker Diseño #${item.position}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-display text-xs font-extrabold text-ink-primary">
                        Diseño #{item.position}
                      </span>
                      <span className="font-mono text-xs font-bold tabular-nums text-accent">
                        {item.quantity.toLocaleString()} uds.
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-ink-secondary">
                      {item.material}
                      {item.vinyl_gloss_mode ? ` (${item.vinyl_gloss_mode})` : ""}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] tabular-nums text-ink-muted">
                      {item.shape} · {item.size_display}
                      {item.image?.original_filename ? ` · ${item.image.original_filename}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-right font-mono text-[10px] tabular-nums text-ink-muted">
            Recepción sellada por el servidor: {formatDateTime(confirmation.received_at)}
          </p>
        </div>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={`https://wa.me/${cleanSupportPhone}?text=${whatsappMessage}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-surface-card px-5 text-sm font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-[0.985] sm:w-auto"
          >
            <MessageCircle className="h-4 w-4 text-accent" aria-hidden="true" />
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
