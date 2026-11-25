import React, { useId, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Scissors, Trash2, UploadCloud } from "lucide-react";
import { THEME_CONFIG } from "@/config/theme.config";

export interface DieCutDropzoneProps {
  label?: string;
  helperText?: string;
  file: File | null;
  previewUrl: string | null;
  error?: string;
  disabled?: boolean;
  accept?: string;
  maxSizeMB?: number;
  maxSizeBytes?: number;
  acceptedMimeTypes?: readonly string[];
  acceptedExtensions?: readonly string[];
  cutlineTag?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onFileChange: (file: File | null) => void;
  className?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Die-cut image upload zone styled like a sticker print cutting mat:
 * dashed cutline perimeter, precision corner crop marks, subtle dot-matrix
 * sheet texture, checkerboard transparency preview, and 100% semantic tokens.
 */
export const DieCutDropzone = React.forwardRef<HTMLDivElement, DieCutDropzoneProps>(
  (
    {
      label = "Imagen del sticker *",
      helperText,
      file,
      previewUrl,
      error,
      disabled = false,
      accept = THEME_CONFIG.upload.acceptAttribute,
      maxSizeMB = THEME_CONFIG.upload.maxSizeMB,
      maxSizeBytes = THEME_CONFIG.upload.maxSizeBytes,
      acceptedMimeTypes = THEME_CONFIG.upload.acceptedMimeTypes,
      acceptedExtensions = [".png", ".jpg", ".jpeg", ".webp", ".svg"],
      cutlineTag = "Línea de corte · Die-cut",
      emptyTitle = "Arrastra tu diseño aquí o haz clic para subir",
      emptyDescription = "Recomendamos fondo transparente (PNG o SVG) en alta resolución",
      onFileChange,
      className = "",
    },
    ref
  ) => {
    const reactId = useId();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    const labelId = `${reactId}-label`;
    const feedbackId = `${reactId}-feedback`;
    const displayError = localError || error;

    const handleCandidate = (candidate: File | null) => {
      setLocalError(null);
      if (!candidate) {
        onFileChange(null);
        return;
      }

      const lowerName = candidate.name.toLowerCase();
      const validExt = acceptedExtensions.some((ext) => lowerName.endsWith(ext));
      const validMime = acceptedMimeTypes.includes(candidate.type);

      if (!validExt && !validMime) {
        setLocalError("Formato no soportado. Usa únicamente PNG, JPG, WEBP o SVG.");
        return;
      }

      if (candidate.size > maxSizeBytes) {
        setLocalError(
          `El archivo pesa ${formatFileSize(candidate.size)} y supera el máximo de ${maxSizeMB} MB.`
        );
        return;
      }

      onFileChange(candidate);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const dropped = e.dataTransfer.files?.[0] ?? null;
      handleCandidate(dropped);
    };

    const triggerFileDialog = () => {
      if (disabled) return;
      inputRef.current?.click();
    };

    const markColor = displayError
      ? "border-state-critical-bg"
      : isDragging
      ? "border-line-diecut"
      : "border-line-diecut/55 group-hover:border-line-diecut";

    return (
      <div ref={ref} className={`w-full space-y-2 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {label && (
            <span
              id={labelId}
              className="text-xs font-semibold uppercase tracking-wider text-ink-secondary"
            >
              {label}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
            <Scissors className="h-3 w-3 text-accent" aria-hidden="true" />
            PNG · JPG · WEBP · SVG · Máx. {maxSizeMB} MB
          </span>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={triggerFileDialog}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={label ? labelId : undefined}
          aria-describedby={displayError || helperText ? feedbackId : undefined}
          aria-invalid={Boolean(displayError)}
          aria-disabled={disabled}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              triggerFileDialog();
            }
          }}
          className={`die-cut-zone group relative rounded-sticker p-5 pt-6 transition-all duration-base ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas sm:p-6 sm:pt-7 ${
            disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer"
          } ${
            displayError
              ? "border-state-critical-bg bg-surface-elevated/45"
              : isDragging
              ? "scale-[1.005] border-line-diecut bg-accent-soft/70 shadow-sticker-hover"
              : "border-line-diecut/75 bg-surface-card hover:border-line-diecut hover:bg-surface-elevated/55 hover:shadow-card"
          } ${!file ? "bg-print-grid" : ""}`}
        >
          {/* Floating die-cut scissor tab anchored on the top cutline */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide shadow-xs transition-colors duration-fast ease-studio ${
              displayError
                ? "border-state-critical-bg bg-state-critical-bg text-state-critical-ink"
                : isDragging
                ? "border-line-diecut bg-accent text-accent-ink"
                : "border-line-diecut/75 bg-surface-card text-ink-secondary group-hover:border-line-diecut group-hover:text-ink-primary"
            }`}
          >
            <Scissors className="h-2.5 w-2.5 shrink-0" />
            {isDragging ? "Soltar sobre la guía" : cutlineTag}
          </span>

          {/* Precision print-shop corner crop / registration marks */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute left-2.5 top-2.5 h-3 w-3 rounded-tl-[2px] border-l-[1.5px] border-t-[1.5px] transition-colors duration-fast ease-studio ${markColor}`}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute right-2.5 top-2.5 h-3 w-3 rounded-tr-[2px] border-r-[1.5px] border-t-[1.5px] transition-colors duration-fast ease-studio ${markColor}`}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-2.5 left-2.5 h-3 w-3 rounded-bl-[2px] border-b-[1.5px] border-l-[1.5px] transition-colors duration-fast ease-studio ${markColor}`}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-2.5 right-2.5 h-3 w-3 rounded-br-[2px] border-b-[1.5px] border-r-[1.5px] transition-colors duration-fast ease-studio ${markColor}`}
          />

          <input
            ref={inputRef}
            type="file"
            accept={accept}
            disabled={disabled}
            tabIndex={-1}
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              handleCandidate(selected);
              e.target.value = "";
            }}
          />

          {file && previewUrl ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="bg-transparency-grid sticker-badge flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-diecut/65 p-2 transition-transform duration-fast ease-studio group-hover:scale-[1.02]">
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
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line-diecut/40 bg-accent-soft px-3 py-1 text-[11px] font-semibold text-ink-primary transition-colors duration-fast ease-studio group-hover:border-line-diecut">
                    <ImagePlus className="h-3 w-3 text-accent" aria-hidden="true" />
                    Cambiar archivo
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocalError(null);
                      onFileChange(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-card px-3 py-1 text-[11px] font-semibold text-ink-secondary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-surface-elevated hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    Quitar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <div
                className={`sticker-badge flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-line-diecut/70 transition-all duration-fast ease-studio ${
                  isDragging
                    ? "scale-110 -rotate-3 bg-accent text-accent-ink shadow-sticker-hover"
                    : "bg-accent-soft text-accent group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:-rotate-3 group-hover:shadow-sticker-hover"
                }`}
              >
                <UploadCloud className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3.5 text-sm font-bold tracking-tight text-ink-primary">
                {emptyTitle}
              </p>
              <p className="mt-1 max-w-md text-xs text-ink-muted">{emptyDescription}</p>
            </div>
          )}
        </div>

        {displayError ? (
          <p
            id={feedbackId}
            role="alert"
            className="flex items-start gap-2 rounded-md border border-state-critical-bg/40 bg-surface-elevated px-3 py-2 text-xs font-semibold text-ink-primary"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
            >
              <AlertCircle className="h-3 w-3" />
            </span>
            <span>{displayError}</span>
          </p>
        ) : (
          helperText && (
            <p id={feedbackId} className="text-xs text-ink-muted">
              {helperText}
            </p>
          )
        )}
      </div>
    );
  }
);

DieCutDropzone.displayName = "DieCutDropzone";
