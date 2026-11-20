import { apiRequest } from "./api";
import type { ImageProcessingCapabilities } from "@/types/order";

export const imageProcessingService = {
  async getCapabilities(): Promise<ImageProcessingCapabilities> {
    return apiRequest<ImageProcessingCapabilities>("/image-processing/capabilities", {
      method: "GET",
      requireAuth: true,
    });
  },
};
