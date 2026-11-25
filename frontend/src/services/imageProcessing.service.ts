import { env } from "@/config/env";
import { firebaseAuth } from "@/config/firebase";
import { ApiError, apiFetchBlob, apiRequest } from "./api";
import type {
  ArtworkVersion,
  BezierAnchor,
  DetectEdgesParams,
  DetectEdgesResult,
  DetectWatermarkMaskResult,
  DieCutBorderCutPosition,
  DieCutDirection,
  DieCutFitMode,
  EnhanceAdjustments,
  EnhanceImageResult,
  EnhanceOutputFormat,
  ImageProcessingCapabilities,
  OrderDesignItemResponse,
  OrderItem,
  RetouchInpaintResult,
  RetouchMode,
  WatermarkTone,
} from "@/types/order";

function normalizeItemId(itemId?: string | null): string | undefined {
  if (!itemId) return undefined;
  const trimmed = itemId.trim();
  if (!trimmed || trimmed.startsWith("legacy-")) return undefined;
  return trimmed;
}

function parseNumericItemId(itemId?: string | null): number | undefined {
  const normalized = normalizeItemId(itemId);
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function appendAdjustments(form: FormData, adjustments: EnhanceAdjustments): void {
  form.append("target_dpi", String(adjustments.target_dpi));
  form.append("upscale_factor", String(adjustments.upscale_factor));
  form.append("denoise_strength", String(adjustments.denoise_strength));
  form.append("sharpen_strength", String(adjustments.sharpen_strength));
  form.append("auto_contrast", String(adjustments.auto_contrast));
  form.append("remove_background", String(adjustments.remove_background));
  form.append("bg_mode", adjustments.bg_mode);
  form.append("bg_tolerance", String(adjustments.bg_tolerance));
  form.append("bg_feather", String(adjustments.bg_feather));
  form.append("brightness", String(adjustments.brightness));
  form.append("contrast", String(adjustments.contrast));
  form.append("saturation", String(adjustments.saturation));
  form.append("gamma", String(adjustments.gamma));
  form.append("cyan", String(adjustments.cyan));
  form.append("magenta", String(adjustments.magenta));
  form.append("yellow", String(adjustments.yellow));
  form.append("black", String(adjustments.black));
  form.append("ink_limit_percent", String(adjustments.ink_limit_percent));
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Yield a single frame back to the browser so sequential batch work never freezes UI rendering. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export interface BatchItemProgressEvent {
  index: number;
  total: number;
  item: OrderDesignItemResponse;
  status: "processing" | "done" | "error";
  enhanced?: EnhanceImageResult;
  updatedOrder?: OrderItem;
  error?: string;
}

export interface BatchEnhanceSummary {
  latestOrder: OrderItem | null;
  results: Record<string, EnhanceImageResult>;
  errors: Array<{ itemId: string; position: number; message: string }>;
  completed: number;
  succeeded: number;
  failed: number;
  cancelled: boolean;
}

export const imageProcessingService = {
  async getCapabilities(): Promise<ImageProcessingCapabilities> {
    return apiRequest<ImageProcessingCapabilities>("/image-processing/capabilities", {
      method: "GET",
      requireAuth: true,
    });
  },

  /**
   * Fetch an order design item's artwork as an authenticated blob Object URL.
   * Supports non-destructive `version` selection ("original" vs "enhanced") and cache busting.
   */
  async fetchOrderItemArtworkUrl(
    orderId: string,
    itemId?: string | null,
    version: ArtworkVersion = "original",
    cacheBust?: number
  ): Promise<string> {
    const normalizedItemId = normalizeItemId(itemId);
    const path = normalizedItemId
      ? `/admin/orders/${orderId}/items/${normalizedItemId}/image`
      : `/admin/orders/${orderId}/image`;

    const { blob } = await apiFetchBlob(path, {
      requireAuth: true,
      query: {
        version,
        ...(cacheBust ? { t: cacheBust } : {}),
      },
    });
    return URL.createObjectURL(blob);
  },

  async enhanceOrderImage(
    orderId: string,
    adjustments: EnhanceAdjustments,
    itemId?: string | null,
    version?: ArtworkVersion
  ): Promise<EnhanceImageResult> {
    const numericItemId = parseNumericItemId(itemId);
    return apiRequest<EnhanceImageResult>("/image-processing/enhance", {
      method: "POST",
      requireAuth: true,
      body: {
        order_id: orderId,
        ...(numericItemId !== undefined ? { item_id: numericItemId } : {}),
        ...(version ? { version } : {}),
        ...adjustments,
        output_format: "png_rgb",
      },
    });
  },

  async enhanceUploadedImage(
    file: File,
    adjustments: EnhanceAdjustments
  ): Promise<EnhanceImageResult> {
    const form = new FormData();
    form.append("image", file);
    appendAdjustments(form, adjustments);

    return apiRequest<EnhanceImageResult>("/image-processing/enhance/upload", {
      method: "POST",
      requireAuth: true,
      body: form,
    });
  },

  async saveEnhancedToOrder(
    orderId: string,
    adjustments: EnhanceAdjustments,
    advanceStatus?: "En Diseño" | "En Impresión" | "Troquelado" | "Listo",
    overrideFile?: File | null,
    itemId?: string | null
  ): Promise<OrderItem> {
    const normalizedItemId = normalizeItemId(itemId);
    const numericItemId = parseNumericItemId(itemId);

    if (overrideFile) {
      const form = new FormData();
      form.append("order_id", orderId);
      if (normalizedItemId) {
        form.append("item_id", normalizedItemId);
      }
      form.append("image", overrideFile);
      if (advanceStatus) {
        form.append("advance_status", advanceStatus);
      }
      appendAdjustments(form, adjustments);
      return apiRequest<OrderItem>("/image-processing/enhance/save-to-order/upload", {
        method: "POST",
        requireAuth: true,
        body: form,
      });
    }

    return apiRequest<OrderItem>("/image-processing/enhance/save-to-order", {
      method: "POST",
      requireAuth: true,
      body: {
        order_id: orderId,
        ...(numericItemId !== undefined ? { item_id: numericItemId } : {}),
        ...adjustments,
        advance_status: advanceStatus ?? null,
      },
    });
  },

  /**
   * Sequentially process and optionally persist the given adjustments across every `item_id`
   * in a multi-design order while yielding to the main thread so the UI stays responsive.
   */
  async enhanceOrderItemsBatch(params: {
    orderId: string;
    items: OrderDesignItemResponse[];
    adjustments: EnhanceAdjustments;
    saveToOrder?: boolean;
    advanceStatus?: "En Diseño" | "En Impresión" | "Troquelado" | "Listo";
    signal?: AbortSignal;
    onProgress?: (event: BatchItemProgressEvent) => void;
  }): Promise<BatchEnhanceSummary> {
    const {
      orderId,
      items,
      adjustments,
      saveToOrder = true,
      advanceStatus,
      signal,
      onProgress,
    } = params;

    const results: Record<string, EnhanceImageResult> = {};
    const errors: Array<{ itemId: string; position: number; message: string }> = [];
    let latestOrder: OrderItem | null = null;
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    let cancelled = false;

    for (let index = 0; index < items.length; index += 1) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }

      const item = items[index];
      onProgress?.({
        index,
        total: items.length,
        item,
        status: "processing",
      });

      await yieldToBrowser();

      if (signal?.aborted) {
        cancelled = true;
        break;
      }

      try {
        const enhanced = await this.enhanceOrderImage(orderId, adjustments, item.id, "original");
        results[item.id] = enhanced;

        let updatedOrder: OrderItem | undefined;
        if (saveToOrder) {
          const isLastItem = index === items.length - 1;
          updatedOrder = await this.saveEnhancedToOrder(
            orderId,
            adjustments,
            isLastItem ? advanceStatus : undefined,
            null,
            item.id
          );
          latestOrder = updatedOrder;
        }

        completed += 1;
        succeeded += 1;
        onProgress?.({
          index,
          total: items.length,
          item,
          status: "done",
          enhanced,
          updatedOrder,
        });
      } catch (err) {
        completed += 1;
        failed += 1;
        const message =
          err instanceof Error ? err.message : "Error inesperado al procesar este diseño.";
        errors.push({ itemId: item.id, position: item.position, message });
        onProgress?.({
          index,
          total: items.length,
          item,
          status: "error",
          error: message,
        });
      }

      await yieldToBrowser();
    }

    return {
      latestOrder,
      results,
      errors,
      completed,
      succeeded,
      failed,
      cancelled,
    };
  },

  async retouchInpaint(params: {
    imageFile: File;
    maskBlob: Blob;
    mode: RetouchMode;
    inpaintRadius: number;
    maskFeather: number;
    maskDilate: number;
    watermarkStrength: number;
    baseColor?: string | null;
    orderId?: string | null;
    itemId?: string | null;
  }): Promise<RetouchInpaintResult> {
    const form = new FormData();
    form.append("image", params.imageFile);
    form.append("mask", new File([params.maskBlob], "retouch-mask.png", { type: "image/png" }));
    if (params.orderId) {
      form.append("order_id", params.orderId);
    }
    const normalizedItemId = normalizeItemId(params.itemId);
    if (normalizedItemId) {
      form.append("item_id", normalizedItemId);
    }
    form.append("mode", params.mode);
    form.append("inpaint_radius", String(params.inpaintRadius));
    form.append("mask_feather", String(params.maskFeather));
    form.append("mask_dilate", String(params.maskDilate));
    form.append("watermark_strength", String(params.watermarkStrength));
    if (params.baseColor) {
      form.append("base_color", params.baseColor);
    }

    return apiRequest<RetouchInpaintResult>("/image-processing/retouch/inpaint", {
      method: "POST",
      requireAuth: true,
      body: form,
    });
  },

  async detectWatermarkMask(params: {
    imageFile: File;
    tone: WatermarkTone;
    sensitivity: number;
    orderId?: string | null;
    itemId?: string | null;
  }): Promise<DetectWatermarkMaskResult> {
    const form = new FormData();
    form.append("image", params.imageFile);
    if (params.orderId) {
      form.append("order_id", params.orderId);
    }
    const normalizedItemId = normalizeItemId(params.itemId);
    if (normalizedItemId) {
      form.append("item_id", normalizedItemId);
    }
    form.append("tone", params.tone);
    form.append("sensitivity", String(params.sensitivity));

    return apiRequest<DetectWatermarkMaskResult>("/image-processing/retouch/detect-watermark", {
      method: "POST",
      requireAuth: true,
      body: form,
    });
  },

  async exportEnhancedImage(params: {
    orderId?: string | null;
    itemId?: string | null;
    file?: File | null;
    adjustments: EnhanceAdjustments;
    outputFormat: EnhanceOutputFormat;
    fallbackFilename: string;
  }): Promise<void> {
    const currentUser = firebaseAuth?.currentUser;
    if (!currentUser) {
      throw new ApiError(401, "Debes iniciar sesión para exportar imágenes.");
    }
    const token = await currentUser.getIdToken();

    const form = new FormData();
    const normalizedItemId = normalizeItemId(params.itemId);
    if (params.orderId) {
      form.append("order_id", params.orderId);
      if (normalizedItemId) {
        form.append("item_id", normalizedItemId);
      }
    } else if (params.file) {
      form.append("image", params.file);
    }
    form.append("output_format", params.outputFormat);
    appendAdjustments(form, params.adjustments);

    const response = await fetch(`${env.apiBaseUrl}/image-processing/enhance/export`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!response.ok) {
      let detail = `No se pudo exportar la imagen (${response.status})`;
      try {
        const json = await response.json();
        if (typeof json?.detail === "string") detail = json.detail;
      } catch {
        // fallback message
      }
      throw new ApiError(response.status, detail);
    }

    const blob = await response.blob();
    let filename = params.fallbackFilename;
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) {
      const match = /filename="([^"]+)"/i.exec(disposition);
      if (match?.[1]) filename = match[1];
    }

    triggerBlobDownload(blob, filename);
  },

  async detectOrderEdges(
    orderId: string,
    params: DetectEdgesParams,
    itemId?: string | null,
    sourceVariant: "enhanced" | "original" = "enhanced"
  ): Promise<DetectEdgesResult> {
    const numericItemId = parseNumericItemId(itemId);
    const {
      target_width_cm,
      target_height_cm,
      fit_mode,
      ...restParams
    } = params;
    return apiRequest<DetectEdgesResult>("/image-processing/detect-edges", {
      method: "POST",
      requireAuth: true,
      body: {
        order_id: orderId,
        ...(numericItemId !== undefined ? { item_id: numericItemId } : {}),
        source_variant: sourceVariant,
        use_original: sourceVariant === "original",
        ...restParams,
        ...(target_width_cm && target_width_cm > 0 ? { target_width_cm } : {}),
        ...(target_height_cm && target_height_cm > 0 ? { target_height_cm } : {}),
        fit_mode: fit_mode ?? "contain_proportional",
      },
    });
  },

  async detectUploadEdges(
    file: File,
    params: DetectEdgesParams
  ): Promise<DetectEdgesResult> {
    const form = new FormData();
    form.append("image", file);
    form.append("mode", params.mode);
    form.append("cut_direction", params.cut_direction);
    form.append("dpi", String(params.dpi));
    form.append("bleed_mm", String(params.bleed_mm));
    form.append("white_border_mm", String(params.white_border_mm ?? 0));
    form.append("corner_roundness", String(params.corner_roundness));
    form.append("smoothing_epsilon", String(params.smoothing_epsilon));
    form.append("polygon_sides", String(params.polygon_sides));
    form.append("polygon_rotation_deg", String(params.polygon_rotation_deg));
    form.append("remove_background", String(params.remove_background));
    form.append("bg_tolerance", String(params.bg_tolerance));
    form.append("merge_islands", String(params.merge_islands));
    form.append("border_mode", params.border_mode);
    if (params.border_color) {
      form.append("border_color", params.border_color);
    }
    form.append("border_width_mm", String(params.border_width_mm));
    form.append("border_cut_position", params.border_cut_position);
    form.append("border_offset_mm", String(params.border_offset_mm));
    if (params.target_width_cm && params.target_width_cm > 0) {
      form.append("target_width_cm", String(params.target_width_cm));
    }
    if (params.target_height_cm && params.target_height_cm > 0) {
      form.append("target_height_cm", String(params.target_height_cm));
    }
    form.append("fit_mode", params.fit_mode ?? "contain_proportional");

    return apiRequest<DetectEdgesResult>("/image-processing/detect-edges/upload", {
      method: "POST",
      requireAuth: true,
      body: form,
    });
  },

  async exportDieCutFile(params: {
    orderId?: string | null;
    itemId?: string | null;
    artworkDataUrl: string;
    title: string;
    imageWidth: number;
    imageHeight: number;
    dpi: number;
    anchors: BezierAnchor[];
    exportFormat: "eps" | "svg";
    advanceStatus?: "Troquelado" | "Listo" | null;
    borderColor?: string | null;
    cutDirection?: DieCutDirection;
    borderWidthMm?: number;
    borderCutPosition?: DieCutBorderCutPosition;
    borderOffsetMm?: number;
    cutStrokeWidthPt?: number;
    targetWidthCm?: number | null;
    targetHeightCm?: number | null;
    fitMode?: DieCutFitMode;
  }): Promise<void> {
    const currentUser = firebaseAuth?.currentUser;
    if (!currentUser) {
      throw new ApiError(401, "Debes iniciar sesión para exportar el troquel.");
    }
    const token = await currentUser.getIdToken();
    const numericItemId = parseNumericItemId(params.itemId);

    const response = await fetch(`${env.apiBaseUrl}/image-processing/die-cut/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: params.orderId || null,
        ...(numericItemId !== undefined ? { item_id: numericItemId } : {}),
        artwork_data_url: params.artworkDataUrl,
        title: params.title,
        image_width: params.imageWidth,
        image_height: params.imageHeight,
        dpi: params.dpi,
        anchors: params.anchors,
        export_format: params.exportFormat,
        advance_status: params.advanceStatus || null,
        border_color: params.borderColor || null,
        cut_direction: params.cutDirection || "outside",
        border_width_mm: params.borderWidthMm ?? 2.0,
        border_cut_position: params.borderCutPosition || "inside_base",
        border_offset_mm: params.borderOffsetMm ?? 1.5,
        cut_stroke_width_pt: params.cutStrokeWidthPt ?? 0.5,
        ...(params.targetWidthCm && params.targetWidthCm > 0
          ? { target_width_cm: params.targetWidthCm }
          : {}),
        ...(params.targetHeightCm && params.targetHeightCm > 0
          ? { target_height_cm: params.targetHeightCm }
          : {}),
        fit_mode: params.fitMode ?? "contain_proportional",
      }),
    });

    if (!response.ok) {
      let detail = `No se pudo exportar el archivo (${response.status})`;
      try {
        const json = await response.json();
        if (typeof json?.detail === "string") detail = json.detail;
      } catch {
        // fallback
      }
      throw new ApiError(response.status, detail);
    }

    const blob = await response.blob();
    let filename = `${params.title}-troquel-2capas.${params.exportFormat}`;
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) {
      const match = /filename="([^"]+)"/i.exec(disposition);
      if (match?.[1]) filename = match[1];
    }

    triggerBlobDownload(blob, filename);
  },

  /**
   * Download a `.ZIP` prepress package containing every saved `.EPS` die-cut file in an order.
   * Connects to `GET /api/v1/image-processing/orders/{order_id}/export-zip`.
   */
  async exportOrderZip(
    orderId: string,
    fallbackFilename?: string
  ): Promise<{ filename: string; packagedItems: number; totalItems: number }> {
    const currentUser = firebaseAuth?.currentUser;
    if (!currentUser) {
      throw new ApiError(401, "Debes iniciar sesión para descargar el paquete .ZIP.");
    }
    const token = await currentUser.getIdToken();

    const response = await fetch(
      `${env.apiBaseUrl}/image-processing/orders/${orderId}/export-zip`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      let detail = `No se pudo generar el paquete .ZIP (${response.status})`;
      try {
        const json = await response.json();
        if (typeof json?.detail === "string") detail = json.detail;
      } catch {
        // fallback
      }
      throw new ApiError(response.status, detail);
    }

    const blob = await response.blob();
    let filename = fallbackFilename || `pedido-${orderId}_preprensa.zip`;
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) {
      const match = /filename="([^"]+)"/i.exec(disposition);
      if (match?.[1]) filename = match[1];
    }

    const packagedItems = Number(response.headers.get("X-Packaged-Items") || "0");
    const totalItems = Number(response.headers.get("X-Total-Items") || "0");

    triggerBlobDownload(blob, filename);
    return { filename, packagedItems, totalItems };
  },

  /**
   * Persist edited Bézier anchors and the 2-layer `.EPS` die-cut artifact directly
   * onto the active `order_item` without triggering a browser file download.
   */
  async saveDieCutToOrderItem(params: {
    orderId: string;
    itemId?: string | null;
    artworkDataUrl?: string | null;
    title: string;
    imageWidth: number;
    imageHeight: number;
    dpi: number;
    anchors: BezierAnchor[];
    advanceStatus?: "Troquelado" | "Listo" | null;
    borderColor?: string | null;
    cutDirection?: DieCutDirection;
    borderWidthMm?: number;
    borderCutPosition?: DieCutBorderCutPosition;
    borderOffsetMm?: number;
    cutStrokeWidthPt?: number;
    targetWidthCm?: number | null;
    targetHeightCm?: number | null;
    fitMode?: DieCutFitMode;
  }): Promise<void> {
    const currentUser = firebaseAuth?.currentUser;
    if (!currentUser) {
      throw new ApiError(401, "Debes iniciar sesión para guardar el troquel del diseño.");
    }
    const token = await currentUser.getIdToken();
    const numericItemId = parseNumericItemId(params.itemId);

    const response = await fetch(`${env.apiBaseUrl}/image-processing/die-cut/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: params.orderId,
        ...(numericItemId !== undefined ? { item_id: numericItemId } : {}),
        artwork_data_url: params.artworkDataUrl || null,
        title: params.title,
        image_width: params.imageWidth,
        image_height: params.imageHeight,
        dpi: params.dpi,
        anchors: params.anchors,
        export_format: "eps",
        save_only: true,
        advance_status: params.advanceStatus || null,
        border_color: params.borderColor || null,
        cut_direction: params.cutDirection || "outside",
        border_width_mm: params.borderWidthMm ?? 2.0,
        border_cut_position: params.borderCutPosition || "inside_base",
        border_offset_mm: params.borderOffsetMm ?? 1.5,
        cut_stroke_width_pt: params.cutStrokeWidthPt ?? 0.5,
        ...(params.targetWidthCm && params.targetWidthCm > 0
          ? { target_width_cm: params.targetWidthCm }
          : {}),
        ...(params.targetHeightCm && params.targetHeightCm > 0
          ? { target_height_cm: params.targetHeightCm }
          : {}),
        fit_mode: params.fitMode ?? "contain_proportional",
      }),
    });

    if (!response.ok) {
      let detail = `No se pudo guardar el troquel en el diseño (${response.status})`;
      try {
        const json = await response.json();
        if (typeof json?.detail === "string") detail = json.detail;
      } catch {
        // fallback
      }
      throw new ApiError(response.status, detail);
    }

    // Consume response body to complete persistence without downloading a local file
    await response.arrayBuffer();
  },

  /**
   * Smart joint production export for multi-design orders:
   * - `format="eps"`: 1 sheet imposition or roll lanes in `.EPS`
   * - `format="pdf"`: separate artboards ready for Adobe Illustrator in `.PDF`
   * Connects to `/image-processing/orders/{order_id}/export-production?format=eps|pdf`
   * (with automatic POST fallback if the server mounts `/export-production` via POST).
   */
  async exportOrderProduction(
    orderId: string,
    format: "eps" | "pdf",
    fallbackFilename?: string
  ): Promise<{ filename: string; format: "eps" | "pdf" }> {
    const currentUser = firebaseAuth?.currentUser;
    if (!currentUser) {
      throw new ApiError(401, "Debes iniciar sesión para exportar el archivo de producción.");
    }
    const token = await currentUser.getIdToken();
    const safeOrderId = encodeURIComponent(orderId);
    const safeFormat = encodeURIComponent(format);

    let response = await fetch(
      `${env.apiBaseUrl}/image-processing/orders/${safeOrderId}/export-production?format=${safeFormat}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (response.status === 405 || response.status === 404) {
      const postOrderScoped = await fetch(
        `${env.apiBaseUrl}/image-processing/orders/${safeOrderId}/export-production`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ order_id: orderId, format }),
        }
      );

      if (postOrderScoped.ok || (postOrderScoped.status !== 404 && postOrderScoped.status !== 405)) {
        response = postOrderScoped;
      } else {
        const postRoot = await fetch(`${env.apiBaseUrl}/image-processing/export-production`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ order_id: orderId, format }),
        });
        if (postRoot.ok || postRoot.status !== 404) {
          response = postRoot;
        }
      }
    }

    if (!response.ok) {
      let detail = `No se pudo generar la exportación de producción .${format.toUpperCase()} (${response.status})`;
      try {
        const json = await response.json();
        if (typeof json?.detail === "string") detail = json.detail;
      } catch {
        // fallback
      }
      throw new ApiError(response.status, detail);
    }

    const blob = await response.blob();
    let filename = fallbackFilename || `pedido-${orderId}_produccion.${format}`;
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) {
      const match = /filename="([^"]+)"/i.exec(disposition);
      if (match?.[1]) filename = match[1];
    }

    triggerBlobDownload(blob, filename);
    return { filename, format };
  },
};
