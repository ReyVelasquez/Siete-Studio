import { THEME_CONFIG } from "@/config/theme.config";

/** Returns today's date in local YYYY-MM-DD format for <input type="date" min={...}> */
export function getLocalTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Suggests the next valid exact delivery date & hour (:00) within operating hours. */
export function getNextAvailableDeliverySlot(): { date: string; hour: string } {
  const now = new Date();
  const { startHour, endHour } = THEME_CONFIG.deliveryHours;
  const nextHour = now.getHours() + 1;

  if (nextHour <= endHour && nextHour >= startHour) {
    return {
      date: getLocalTodayIsoDate(),
      hour: `${String(nextHour).padStart(2, "0")}:00`,
    };
  }

  if (nextHour < startHour) {
    return {
      date: getLocalTodayIsoDate(),
      hour: `${String(startHour).padStart(2, "0")}:00`,
    };
  }

  // After closing hours -> tomorrow at opening hour
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  return {
    date: `${y}-${m}-${d}`,
    hour: `${String(startHour).padStart(2, "0")}:00`,
  };
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(THEME_CONFIG.brand.locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDeliveryShort(iso: string): { dateLabel: string; timeLabel: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dateLabel: iso, timeLabel: "" };
  return {
    dateLabel: date.toLocaleDateString(THEME_CONFIG.brand.locale, {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }),
    timeLabel: date.toLocaleTimeString(THEME_CONFIG.brand.locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

export function getDeliveryUrgency(
  iso: string,
  status: string
): "overdue" | "today" | "upcoming" | "done" {
  if (status === "Entregado" || status === "Cancelado") return "done";
  const delivery = new Date(iso);
  const now = new Date();
  if (delivery.getTime() < now.getTime()) return "overdue";

  const isSameDay =
    delivery.getFullYear() === now.getFullYear() &&
    delivery.getMonth() === now.getMonth() &&
    delivery.getDate() === now.getDate();

  return isSameDay ? "today" : "upcoming";
}
