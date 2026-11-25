import React from "react";
import { DieCutDropzone } from "@/components/ui/DieCutDropzone";

export interface StickerDropzoneProps {
  label?: string;
  helperText?: string;
  cutlineTag?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  file: File | null;
  previewUrl: string | null;
  error?: string;
  disabled?: boolean;
  onFileChange: (file: File | null) => void;
}

/**
 * Order-domain wrapper around the base `DieCutDropzone` UI primitive.
 * Keeps existing order-form prop signatures intact while delegating all
 * die-cut styling and token discipline to `components/ui/DieCutDropzone`.
 */
export const StickerDropzone: React.FC<StickerDropzoneProps> = ({
  label,
  helperText,
  cutlineTag,
  emptyTitle,
  emptyDescription,
  file,
  previewUrl,
  error,
  disabled,
  onFileChange,
}) => {
  return (
    <DieCutDropzone
      label={label}
      helperText={helperText}
      cutlineTag={cutlineTag}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      file={file}
      previewUrl={previewUrl}
      error={error}
      disabled={disabled}
      onFileChange={onFileChange}
    />
  );
};
