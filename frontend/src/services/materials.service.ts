import { apiRequest } from "./api";
import { THEME_CONFIG } from "@/config/theme.config";
import type { MaterialItem, MaterialListResponse, StickerMaterial } from "@/types/order";

export interface MaterialPayload {
  name: string;
  description?: string | null;
  requires_gloss_mode: boolean;
  base_unit_price: number;
  is_active: boolean;
}

export interface PublicMaterialOption {
  value: StickerMaterial;
  label: string;
  description: string;
  badge: string;
  requiresGlossMode: boolean;
  baseUnitPrice?: number;
}

const FALLBACK_BY_NAME = new Map<string, (typeof THEME_CONFIG.materials)[number]>(
  THEME_CONFIG.materials.map((m) => [m.value, m])
);

const VALID_MATERIAL_NAMES = new Set<string>(THEME_CONFIG.materials.map((m) => m.value));

export function getFallbackPublicMaterials(): PublicMaterialOption[] {
  return THEME_CONFIG.materials.map((m) => ({
    value: m.value,
    label: m.label,
    description: m.description,
    badge: m.badge,
    requiresGlossMode: m.requiresGlossMode,
  }));
}

/**
 * Map active API materials from `GET /api/v1/public/materials` into validated UI options,
 * enriching badges from `THEME_CONFIG.materials` and falling back cleanly if empty.
 */
export function mapPublicMaterialsToOptions(
  apiItems: MaterialItem[] | null | undefined
): PublicMaterialOption[] {
  if (!apiItems || apiItems.length === 0) {
    return getFallbackPublicMaterials();
  }

  const mapped: PublicMaterialOption[] = [];
  for (const item of apiItems) {
    if (!item.is_active) continue;
    if (!VALID_MATERIAL_NAMES.has(item.name)) continue;

    const value = item.name as StickerMaterial;
    const fallback = FALLBACK_BY_NAME.get(value);
    const requiresGlossMode = Boolean(item.requires_gloss_mode);

    mapped.push({
      value,
      label: item.name,
      description: item.description?.trim() || fallback?.description || "Sustrato profesional de taller.",
      badge:
        fallback?.badge ||
        (requiresGlossMode ? "Requiere modalidad" : "Catálogo activo"),
      requiresGlossMode,
      baseUnitPrice:
        typeof item.base_unit_price === "number" && item.base_unit_price > 0
          ? item.base_unit_price
          : undefined,
    });
  }

  return mapped.length > 0 ? mapped : getFallbackPublicMaterials();
}

export const materialsService = {
  async listPublicMaterials(): Promise<MaterialListResponse> {
    return apiRequest<MaterialListResponse>("/public/materials", {
      method: "GET",
      requireAuth: false,
    });
  },

  async listAdminMaterials(): Promise<MaterialListResponse> {
    return apiRequest<MaterialListResponse>("/admin/materials", {
      method: "GET",
      requireAuth: true,
    });
  },

  async createMaterial(payload: MaterialPayload): Promise<MaterialItem> {
    return apiRequest<MaterialItem>("/admin/materials", {
      method: "POST",
      body: payload as unknown as Record<string, unknown>,
      requireAuth: true,
    });
  },

  async updateMaterial(id: number, payload: Partial<MaterialPayload>): Promise<MaterialItem> {
    return apiRequest<MaterialItem>(`/admin/materials/${id}`, {
      method: "PATCH",
      body: payload as unknown as Record<string, unknown>,
      requireAuth: true,
    });
  },

  async deleteMaterial(id: number): Promise<void> {
    await apiRequest<void>(`/admin/materials/${id}`, {
      method: "DELETE",
      requireAuth: true,
    });
  },
};
