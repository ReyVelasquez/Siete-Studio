import React, { useRef, useState } from "react";
import { ImagePlus, Scissors, Trash2, UploadCloud } from "lucide-react";
import { THEME_CONFIG } from "@/config/theme.config";

interface StickerDropzoneProps {
  file: File | null;
  previewUrl: string | null;
  error?: string;
  onFileChange: (file: File | null) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const StickerDropzone: React.FC<StickerDropzoneProps> = ({
  file,
  previewUrl,
  error,
  onFileChange,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleCandidate = (candidate: File | null) => {
    setLocalError(null);
    if (!candidate) {
      onFileChange(null);
      return;
    }

    const lowerName = candidate.name.toLowerCase();
    const validExt = [".png", ".jpg", ".jpeg", ".webp", ".svg"].some((ext) =>
      lowerName.endsWith(ext)
    );
    const validMime = (THEME_CONFIG.upload.acceptedMimeTypes as readonly string[]).includes(
      candidate.type
    );

    if (!validExt && !validMime) {
      setLocalError("Formato no soportado. Usa únicamente PNG, JPG, WEBP o SVG.");
      return;
    }

    if (candidate.size > THEME_CONFIG.upload.maxSizeBytes) {
      setLocalError(
        `El archivo pesa ${formatFileSize(candidate.size)} y supera el máximo de ${THEME_CONFIG.upload.maxSizeMB} MB.`
      );
      return;
    }

    onFileChange(candidate);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0] ?? null;
    handleCandidate(dropped);
  };

  const displayError = localError || error;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Imagen del sticker *
        </label>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted">
          <Scissors className="h-3 w-3" />
          PNG · JPG · WEBP · SVG · Máx. {THEME_CONFIG.upload.maxSizeMB} MB
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`die-cut-zone group cursor-pointer rounded-sticker p-5 transition-all ${
          isDragging
            ? "scale-[1.01] bg-accent-soft/70"
            : "hover:bg-surface-elevated/60"
        } ${displayError ? "border-brand-800 dark:border-brand-300" : ""}`}
      >
        {/* Corner print registration crosshairs */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-2 font-mono text-[10px] leading-none text-line-diecut opacity-60"
        >
          +
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-2 font-mono text-[10px] leading-none text-line-diecut opacity-60"
        >
          +
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] leading-none text-line-diecut opacity-60"
        >
          +
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2 right-2 font-mono text-[10px] leading-none text-line-diecut opacity-60"
        >
          +
        </span>

        <input
          ref={inputRef}
          type="file"
          accept={THEME_CONFIG.upload.acceptAttribute}
          className="hidden"
          onChange={(e) => {
            const selected = e.target.files?.[0] ?? null;
            handleCandidate(selected);
            e.target.value = "";
          }}
        />

        {file && previewUrl ? (
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="bg-transparency-grid flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line-subtle p-2">
              <img
                src={previewUrl}
                alt="Vista previa del diseño"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="truncate text-sm font-bold text-ink-primary">{file.name}</p>
              <p className="mt-1 font-mono text-xs text-ink-muted">
                {formatFileSize(file.size)} · {file.type || "Imagen"}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-ink-primary">
                  <ImagePlus className="h-3 w-3" />
                  Clic para cambiar archivo
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocalError(null);
                    onFileChange(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-card px-2.5 py-1 text-[11px] font-semibold text-ink-secondary hover:text-ink-primary"
                >
                  <Trash2 className="h-3 w-3" />
                  Quitar
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent transition-transform group-hover:scale-105">
              <UploadCloud className="h-6 w-6" />
            </div>
            <p className="mt-3 text-sm font-bold text-ink-primary">
              Arrastra tu diseño aquí o haz clic para subir
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Recomendamos fondo transparente (PNG o SVG) en alta resolución
            </p>
          </div>
        )}
      </div>

      {displayError && (
        <p role="alert" className="text-xs font-semibold text-brand-800 dark:text-brand-200">
          • {displayError}
        </p>
      )}
    </div>
  );
};
