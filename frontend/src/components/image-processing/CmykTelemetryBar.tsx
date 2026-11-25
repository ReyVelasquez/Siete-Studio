import React from "react";
import { AlertTriangle, CheckCircle2, Droplets } from "lucide-react";
import type { CmykStats } from "@/types/order";

interface CmykTelemetryBarProps {
  stats: CmykStats | null;
  inkLimit: number;
}

export const CmykTelemetryBar: React.FC<CmykTelemetryBarProps> = ({ stats, inkLimit }) => {
  const channels = [
    {
      key: "C",
      label: "Cian",
      value: stats?.avg_cyan ?? 0,
      barTone: "bg-accent/70",
      chipTone: "bg-accent/15 text-accent border-line-diecut/40",
    },
    {
      key: "M",
      label: "Magenta",
      value: stats?.avg_magenta ?? 0,
      barTone: "bg-accent",
      chipTone: "bg-accent text-accent-ink border-accent",
    },
    {
      key: "Y",
      label: "Amarillo",
      value: stats?.avg_yellow ?? 0,
      barTone: "bg-accent/45",
      chipTone: "bg-surface-elevated text-ink-secondary border-line-strong/60",
    },
    {
      key: "K",
      label: "Negro",
      value: stats?.avg_black ?? 0,
      barTone: "bg-surface-inverted",
      chipTone: "bg-surface-inverted text-ink-inverted border-surface-inverted",
    },
  ];

  const tacBarWidth = stats ? Math.min(100, Math.max(0, (stats.max_tac_percent / 400) * 100)) : 0;
  const tacLimitMarker = Math.min(100, Math.max(0, (inkLimit / 400) * 100));

  return (
    <section
      aria-label="Telemetría de tintas CMYK"
      className="rounded-sticker border border-line-subtle bg-surface-elevated/55 p-4 shadow-xs"
    >
      {/* Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-dashed border-line-subtle pb-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
          >
            <Droplets className="h-3.5 w-3.5" />
          </span>
          <div>
            <span className="block font-display text-xs font-extrabold tracking-tight text-ink-primary">
              Telemetría de Tintas CMYK
            </span>
            <span className="block font-mono text-[10px] font-semibold text-ink-muted">
              Control de cobertura en preprensa
            </span>
          </div>
        </div>

        {stats ? (
          <span
            className={`sticker-badge inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
              stats.tac_warning
                ? "border-state-critical-bg bg-state-critical-bg text-state-critical-ink"
                : "border-dashed border-line-diecut bg-surface-card text-ink-primary"
            }`}
          >
            {stats.tac_warning ? (
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            )}
            TAC Máx: {stats.max_tac_percent.toFixed(1)}% · Límite {inkLimit}%
          </span>
        ) : (
          <span className="rounded-full border border-dashed border-line-strong bg-surface-card px-2.5 py-0.5 font-mono text-[10px] font-semibold text-ink-muted">
            Sin analizar · Aplica el proceso
          </span>
        )}
      </div>

      {/* Total Ink Coverage (TAC) Bar with Limit Marker */}
      {stats && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] text-ink-muted">
            <span className="font-semibold uppercase tracking-wider">
              Cobertura Total (TAC 0–400%)
            </span>
            <span className="tabular-nums font-bold text-ink-primary">
              {stats.max_tac_percent.toFixed(1)}% / {inkLimit}%
            </span>
          </div>
          <div className="relative h-2 w-full overflow-visible rounded-full bg-surface-card ring-1 ring-line-subtle">
            <div
              style={{ width: `${tacBarWidth}%` }}
              className={`h-full rounded-full transition-all duration-base ease-studio ${
                stats.tac_warning ? "bg-state-critical-bg" : "bg-accent"
              }`}
            />
            <span
              aria-hidden="true"
              title={`Límite TAC configurado: ${inkLimit}%`}
              style={{ left: `${tacLimitMarker}%` }}
              className="absolute -top-0.5 h-3 w-0.5 -translate-x-1/2 rounded-full bg-ink-primary"
            />
          </div>
        </div>
      )}

      {/* 4 CMYK Press Channel Cards */}
      <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {channels.map((ch) => (
          <div
            key={ch.key}
            className="rounded-md border border-line-subtle bg-surface-card p-3 shadow-xs transition-colors duration-fast ease-studio hover:border-line-diecut/60"
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border font-mono text-[10px] font-extrabold ${ch.chipTone}`}
                >
                  {ch.key}
                </span>
                <span className="text-[11px] font-semibold text-ink-secondary">{ch.label}</span>
              </div>
              <span className="font-mono text-xs font-extrabold tabular-nums text-ink-primary">
                {stats ? `${ch.value.toFixed(1)}%` : "—"}
              </span>
            </div>

            <div
              role="progressbar"
              aria-label={`Cobertura de ${ch.label}`}
              aria-valuenow={Math.round(ch.value)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-surface-elevated"
            >
              <div
                style={{ width: `${Math.min(100, Math.max(0, ch.value))}%` }}
                className={`h-full rounded-full transition-all duration-base ease-studio ${ch.barTone}`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Over-Ink Prepress Warning */}
      {stats?.tac_warning && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2.5 rounded-lg border border-dashed border-state-critical-bg/70 bg-surface-card px-3.5 py-2.5 text-[11px] leading-relaxed text-ink-secondary"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
          >
            <AlertTriangle className="h-3 w-3" />
          </span>
          <p>
            <strong className="font-bold text-ink-primary">Aviso de imprenta:</strong> la cobertura
            total de tinta supera 300%. Reduce el límite TAC a{" "}
            <strong className="rounded-xs bg-surface-elevated px-1 py-0.5 font-mono text-ink-primary">
              280%
            </strong>{" "}
            o{" "}
            <strong className="rounded-xs bg-surface-elevated px-1 py-0.5 font-mono text-ink-primary">
              260%
            </strong>{" "}
            para evitar exceso de tinta en vinilo o papel adhesivo.
          </p>
        </div>
      )}
    </section>
  );
};
