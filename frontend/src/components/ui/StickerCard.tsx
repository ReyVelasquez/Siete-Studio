import React from "react";

interface StickerCardProps extends React.HTMLAttributes<HTMLDivElement> {
  peel?: boolean;
  dieCut?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingMap = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

export const StickerCard: React.FC<StickerCardProps> = ({
  peel = false,
  dieCut = false,
  padding = "md",
  className = "",
  children,
  ...rest
}) => {
  return (
    <div
      className={`rounded-sticker bg-surface-card shadow-card ${
        dieCut ? "die-cut-zone" : "border border-line-subtle"
      } ${peel ? "sticker-peel" : ""} ${paddingMap[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};
