import React, { useEffect, useState } from "react";
import { Cpu, Layers, Sparkles } from "lucide-react";
import { THEME_CONFIG } from "@/config/theme.config";
import { Modal } from "@/components/ui/Modal";
import { imageProcessingService } from "@/services/imageProcessing.service";
import type { ImageProcessingCapabilities } from "@/types/order";

interface Phase2PreviewModalProps {
  selectedModuleId: "enhancer" | "edge_detector" | "layout_packer" | null;
  onClose: () => void;
}

export const Phase2PreviewModal: React.FC<Phase2PreviewModalProps> = ({
  selectedModuleId,
  onClose,
}) => {
  const [capabilities, setCapabilities] = useState<ImageProcessingCapabilities | null>(null);

  useEffect(() => {
    if (!selectedModuleId) return;
    let active = true;
    imageProcessingService
      .getCapabilities()
      .then((res) => {
        if (active) setCapabilities(res);
      })
      .catch(() => {
        if (active) setCapabilities(null);
      });
    return () => {
      active = false;
    };
  }, [selectedModuleId]);

  const moduleMeta = THEME_CONFIG.phase2Modules.find((m) => m.id === selectedModuleId);
  const apiModule = capabilities?.modules.find((m) => m.id === selectedModuleId);

  return (
    <Modal
      isOpen={Boolean(selectedModuleId)}
      onClose={onClose}
      title={moduleMeta ? `${moduleMeta.title} · Próximamente` : "Módulo Fase 2"}
      subtitle="Arquitectura modular preparada en backend/app/modules/image_processing/"
      maxWidthClass="max-w-xl"
    >
      {moduleMeta && (
        <div className="space-y-4 text-sm">
          <div className="die-cut-zone rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent">
              <Sparkles className="h-4 w-4" />
              <span>{moduleMeta.badge}</span>
            </div>
            <p className="mt-2 leading-relaxed text-ink-secondary">
              {apiModule?.description || moduleMeta.summary}
            </p>
          </div>

          <div className="rounded-lg border border-line-subtle bg-surface-elevated/70 p-4 text-xs">
            <div className="flex items-center gap-2 font-bold text-ink-primary">
              <Cpu className="h-4 w-4 text-accent" />
              <span>Stack Técnico Planificado</span>
            </div>
            <p className="mt-1.5 font-mono text-ink-secondary">{moduleMeta.stack}</p>
            {apiModule && (
              <p className="mt-2 font-mono text-[11px] text-ink-muted">
                Endpoint stub protegido: <strong className="text-ink-primary">{apiModule.endpoint}</strong>
              </p>
            )}
          </div>

          {capabilities && (
            <div className="rounded-lg border border-line-subtle p-4 text-xs">
              <div className="mb-2 flex items-center gap-2 font-bold text-ink-primary">
                <Layers className="h-4 w-4 text-accent" />
                <span>Estado de Librerías Python en el Servidor</span>
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                <div className="rounded bg-surface-elevated px-2.5 py-2">
                  OpenCV: <strong>{capabilities.opencv_installed ? "Listo" : "Opcional"}</strong>
                </div>
                <div className="rounded bg-surface-elevated px-2.5 py-2">
                  NumPy: <strong>{capabilities.numpy_installed ? "Listo" : "Opcional"}</strong>
                </div>
                <div className="rounded bg-surface-elevated px-2.5 py-2">
                  rembg: <strong>{capabilities.rembg_installed ? "Listo" : "Opcional"}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
