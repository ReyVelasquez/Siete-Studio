import { apiFetchBlob, apiRequest } from "./api";
import type {
  DashboardSummary,
  OrderItem,
  OrderListResponse,
  OrderSalesUpdatePayload,
  OrderStatus,
  PaymentMethod,
  PublicOrderConfirmation,
  StickerMaterial,
  StickerShape,
  VinylGlossMode,
} from "@/types/order";

export interface SubmitOrderPayload {
  referral_name: string;
  phone: string;
  material: StickerMaterial;
  vinyl_gloss_mode?: VinylGlossMode | null;
  shape: StickerShape;
  diameter_cm?: string;
  dimensions?: string;
  quantity: number;
  delivery_date: string;
  delivery_hour: string;
  image: File;
}

export interface SubmitAdminQuickOrderPayload extends SubmitOrderPayload {
  total_price?: number;
  advance_payment?: number;
  payment_method?: PaymentMethod;
  status?: OrderStatus;
  notes?: string;
}

export interface OrderFilters {
  status?: OrderStatus | "";
  material?: StickerMaterial | "";
  shape?: StickerShape | "";
  search?: string;
  only_pending?: boolean;
  delivery_date?: string;
}

/** Build timezone-aware ISO datetime string keeping the exact selected hour (:00). */
function buildExactHourIso(deliveryDate: string, deliveryHour: string): string {
  const local = new Date(`${deliveryDate}T${deliveryHour}:00`);
  const tzOffsetMin = -local.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(tzOffsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, "0");
  const mm = String(absMin % 60).padStart(2, "0");
  return `${deliveryDate}T${deliveryHour}:00${sign}${hh}:${mm}`;
}

function buildOrderFormData(payload: SubmitOrderPayload): FormData {
  const form = new FormData();
  form.append("referral_name", payload.referral_name.trim());
  form.append("phone", payload.phone.trim());
  form.append("material", payload.material);
  if (payload.material === "Vinilo Brillo" && payload.vinyl_gloss_mode) {
    form.append("vinyl_gloss_mode", payload.vinyl_gloss_mode);
  }
  form.append("shape", payload.shape);
  if (payload.shape === "Circular" && payload.diameter_cm) {
    form.append("diameter_cm", payload.diameter_cm.replace(",", "."));
  } else if (payload.shape !== "Circular" && payload.dimensions) {
    form.append("dimensions", payload.dimensions.trim());
  }
  form.append("quantity", String(payload.quantity));
  form.append(
    "delivery_datetime",
    buildExactHourIso(payload.delivery_date, payload.delivery_hour)
  );
  form.append("image", payload.image);
  return form;
}

export const ordersService = {
  async createPublicOrder(payload: SubmitOrderPayload): Promise<PublicOrderConfirmation> {
    const formData = buildOrderFormData(payload);
    return apiRequest<PublicOrderConfirmation>("/public/orders", {
      method: "POST",
      body: formData,
      requireAuth: false,
    });
  },

  async getDashboardSummary(): Promise<DashboardSummary> {
    return apiRequest<DashboardSummary>("/dashboard/summary", {
      method: "GET",
      requireAuth: true,
    });
  },

  async listAdminOrders(filters: OrderFilters = {}): Promise<OrderListResponse> {
    return apiRequest<OrderListResponse>("/admin/orders", {
      method: "GET",
      requireAuth: true,
      query: {
        status: filters.status || undefined,
        material: filters.material || undefined,
        shape: filters.shape || undefined,
        search: filters.search?.trim() || undefined,
        only_pending: filters.only_pending ? "true" : undefined,
        delivery_date: filters.delivery_date || undefined,
      },
    });
  },

  async createAdminQuickOrder(payload: SubmitAdminQuickOrderPayload): Promise<OrderItem> {
    const formData = buildOrderFormData(payload);
    formData.append("total_price", String(payload.total_price ?? 0));
    formData.append("advance_payment", String(payload.advance_payment ?? 0));
    formData.append("payment_method", payload.payment_method ?? "Pendiente");
    formData.append("status", payload.status ?? "Pendiente");
    if (payload.notes?.trim()) {
      formData.append("notes", payload.notes.trim());
    }

    return apiRequest<OrderItem>("/admin/orders", {
      method: "POST",
      body: formData,
      requireAuth: true,
    });
  },

  async updateOrderSales(
    orderId: string,
    payload: OrderSalesUpdatePayload
  ): Promise<OrderItem> {
    return apiRequest<OrderItem>(`/admin/orders/${orderId}`, {
      method: "PATCH",
      body: payload as Record<string, unknown>,
      requireAuth: true,
    });
  },

  async fetchOrderImageObjectUrl(orderId: string): Promise<string> {
    const { blob } = await apiFetchBlob(`/admin/orders/${orderId}/image`, {
      requireAuth: true,
    });
    return URL.createObjectURL(blob);
  },

  async downloadOrderImageFile(orderId: string, fallbackFilename: string): Promise<void> {
    const { blob, contentDisposition } = await apiFetchBlob(`/admin/orders/${orderId}/image`, {
      requireAuth: true,
      query: { download: true },
    });

    let filename = fallbackFilename;
    if (contentDisposition) {
      const match = /filename="([^"]+)"/i.exec(contentDisposition);
      if (match?.[1]) {
        filename = match[1];
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },
};
