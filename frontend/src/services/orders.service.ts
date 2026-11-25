import { apiFetchBlob, apiRequest } from "./api";
import { resolveDesignMeasureSpec } from "@/schemas/order.schema";
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
  StickerSizeMode,
  VinylGlossMode,
} from "@/types/order";

export interface SubmitOrderDesignItem {
  material: StickerMaterial;
  vinyl_gloss_mode?: VinylGlossMode | null;
  shape: StickerShape;
  diameter_cm?: string;
  size_mode?: StickerSizeMode;
  height_cm?: string | number;
  width_cm?: string | number;
  dimensions?: string;
  quantity: number;
  image: File;
  image_index?: number;
}

export interface SubmitMultiDesignOrderPayload {
  referral_name: string;
  phone: string;
  delivery_date: string;
  delivery_hour: string;
  items: SubmitOrderDesignItem[];
  uniqueImages?: File[];
}

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

export interface SubmitAdminQuickOrderPayload extends SubmitMultiDesignOrderPayload {
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

function buildMultiDesignOrderFormData(payload: SubmitMultiDesignOrderPayload): FormData {
  const form = new FormData();
  form.append("referral_name", payload.referral_name.trim());
  form.append("phone", payload.phone.trim());
  form.append(
    "delivery_datetime",
    buildExactHourIso(payload.delivery_date, payload.delivery_hour)
  );

  const usesImageIndex = payload.items.some((it) => typeof it.image_index === "number");
  const uniqueUploadFiles: File[] =
    payload.uniqueImages && payload.uniqueImages.length > 0 ? [...payload.uniqueImages] : [];

  const resolveFileUploadIndex = (file: File, explicitIndex?: number): number | undefined => {
    if (!usesImageIndex) return undefined;
    if (
      typeof explicitIndex === "number" &&
      payload.uniqueImages &&
      payload.uniqueImages[explicitIndex]
    ) {
      return explicitIndex;
    }
    const foundIdx = uniqueUploadFiles.findIndex(
      (f) =>
        f === file ||
        (f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)
    );
    if (foundIdx >= 0) return foundIdx;
    const nextIdx = uniqueUploadFiles.length;
    uniqueUploadFiles.push(file);
    return nextIdx;
  };

  const serializedItems = payload.items.map((item) => {
    const isVinylGloss = item.material === "Vinilo Brillo";
    const isCircular = item.shape === "Circular";
    const resolvedImageIndex = resolveFileUploadIndex(item.image, item.image_index);
    const parsedDiameter =
      isCircular && item.diameter_cm
        ? Number(item.diameter_cm.trim().replace(",", "."))
        : null;

    if (isCircular) {
      return {
        material: item.material,
        vinyl_gloss_mode: isVinylGloss ? (item.vinyl_gloss_mode ?? null) : null,
        shape: item.shape,
        diameter_cm:
          parsedDiameter !== null && Number.isFinite(parsedDiameter) ? parsedDiameter : null,
        dimensions: null,
        quantity: Number(item.quantity),
        ...(resolvedImageIndex !== undefined ? { image_index: resolvedImageIndex } : {}),
      };
    }

    const resolvedMeasure = resolveDesignMeasureSpec({
      shape: item.shape,
      size_mode: item.size_mode ?? "both",
      height_cm: item.height_cm,
      width_cm: item.width_cm,
      dimensions: item.dimensions,
    });

    return {
      material: item.material,
      vinyl_gloss_mode: isVinylGloss ? (item.vinyl_gloss_mode ?? null) : null,
      shape: item.shape,
      diameter_cm: null,
      size_mode: resolvedMeasure.effectiveMode,
      height_cm:
        resolvedMeasure.effectiveMode === "both" || resolvedMeasure.effectiveMode === "height_only"
          ? resolvedMeasure.heightCm
          : null,
      width_cm:
        resolvedMeasure.effectiveMode === "both" || resolvedMeasure.effectiveMode === "width_only"
          ? resolvedMeasure.widthCm
          : null,
      dimensions: resolvedMeasure.normalizedDimensions,
      quantity: Number(item.quantity),
      ...(resolvedImageIndex !== undefined ? { image_index: resolvedImageIndex } : {}),
    };
  });

  form.append("items", JSON.stringify(serializedItems));
  if (usesImageIndex && uniqueUploadFiles.length > 0) {
    for (const uniqueFile of uniqueUploadFiles) {
      form.append("images", uniqueFile);
    }
  } else {
    for (const item of payload.items) {
      form.append("images", item.image);
    }
  }
  return form;
}

function triggerBlobDownload(blob: Blob, fallbackFilename: string, contentDisposition: string | null) {
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
}

export const ordersService = {
  async createPublicOrder(
    payload: SubmitMultiDesignOrderPayload
  ): Promise<PublicOrderConfirmation> {
    const formData = buildMultiDesignOrderFormData(payload);
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

  async getOrderById(orderId: string): Promise<OrderItem> {
    return apiRequest<OrderItem>(`/admin/orders/${orderId}`, {
      method: "GET",
      requireAuth: true,
    });
  },

  async createAdminQuickOrder(payload: SubmitAdminQuickOrderPayload): Promise<OrderItem> {
    const formData = buildMultiDesignOrderFormData(payload);
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

  async deleteOrder(orderId: string): Promise<void> {
    await apiRequest<void>(`/admin/orders/${orderId}`, {
      method: "DELETE",
      requireAuth: true,
    });
  },

  async fetchOrderImageObjectUrl(
    orderId: string,
    variant?: "original" | "enhanced"
  ): Promise<string> {
    const { blob } = await apiFetchBlob(`/admin/orders/${orderId}/image`, {
      requireAuth: true,
      query: variant ? { variant } : undefined,
    });
    return URL.createObjectURL(blob);
  },

  async fetchOrderItemImageObjectUrl(
    orderId: string,
    itemId: string,
    variant?: "original" | "enhanced"
  ): Promise<string> {
    const { blob } = await apiFetchBlob(`/admin/orders/${orderId}/items/${itemId}/image`, {
      requireAuth: true,
      query: variant ? { variant } : undefined,
    });
    return URL.createObjectURL(blob);
  },

  async downloadOrderImageFile(orderId: string, fallbackFilename: string): Promise<void> {
    const { blob, contentDisposition } = await apiFetchBlob(`/admin/orders/${orderId}/image`, {
      requireAuth: true,
      query: { download: true },
    });
    triggerBlobDownload(blob, fallbackFilename, contentDisposition);
  },

  async downloadOrderItemImageFile(
    orderId: string,
    itemId: string,
    fallbackFilename: string
  ): Promise<void> {
    const { blob, contentDisposition } = await apiFetchBlob(
      `/admin/orders/${orderId}/items/${itemId}/image`,
      {
        requireAuth: true,
        query: { download: true },
      }
    );
    triggerBlobDownload(blob, fallbackFilename, contentDisposition);
  },
};
