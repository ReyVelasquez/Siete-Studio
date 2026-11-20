import { apiRequest } from "./api";
import type {
  AdminRestorePasswordResponse,
  UserListResponse,
  UserProfile,
  UserRoleCode,
} from "@/types/order";

export interface CreateUserPayload {
  display_name: string;
  email: string;
  password: string;
  role: UserRoleCode;
  email_verified: boolean;
}

export interface UpdateUserPayload {
  display_name?: string;
  role?: UserRoleCode;
  is_active?: boolean;
  email_verified?: boolean;
}

export const usersService = {
  async getMyProfile(): Promise<UserProfile> {
    return apiRequest<UserProfile>("/auth/me", {
      method: "GET",
      requireAuth: true,
    });
  },

  async syncEmailVerification(): Promise<UserProfile> {
    return apiRequest<UserProfile>("/auth/sync-verification", {
      method: "POST",
      requireAuth: true,
    });
  },

  async listUsers(params: { search?: string; role?: UserRoleCode | "" } = {}): Promise<UserListResponse> {
    return apiRequest<UserListResponse>("/admin/users", {
      method: "GET",
      requireAuth: true,
      query: {
        search: params.search?.trim() || undefined,
        role: params.role || undefined,
      },
    });
  },

  async createUser(payload: CreateUserPayload): Promise<UserProfile> {
    return apiRequest<UserProfile>("/admin/users", {
      method: "POST",
      body: payload as unknown as Record<string, unknown>,
      requireAuth: true,
    });
  },

  async updateUser(userId: number, payload: UpdateUserPayload): Promise<UserProfile> {
    return apiRequest<UserProfile>(`/admin/users/${userId}`, {
      method: "PATCH",
      body: payload as unknown as Record<string, unknown>,
      requireAuth: true,
    });
  },

  async deleteUser(userId: number): Promise<void> {
    await apiRequest<void>(`/admin/users/${userId}`, {
      method: "DELETE",
      requireAuth: true,
    });
  },

  async restorePassword(
    userId: number,
    payload: { mode: "temporary_password" | "reset_link"; new_password?: string }
  ): Promise<AdminRestorePasswordResponse> {
    return apiRequest<AdminRestorePasswordResponse>(`/admin/users/${userId}/restore-password`, {
      method: "POST",
      body: payload as unknown as Record<string, unknown>,
      requireAuth: true,
    });
  },
};
