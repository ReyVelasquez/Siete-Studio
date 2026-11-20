import { apiRequest } from "./api";
import type { MaterialItem, MaterialListResponse } from "@/types/order";

export interface MaterialPayload {
  name: string;
  description?: string | null;
  requires_gloss_mode: boolean;
  base_unit_price: number;
  is_active: boolean;
}

export const materialsService = {
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
