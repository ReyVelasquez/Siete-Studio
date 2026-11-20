import { env } from "@/config/env";
import { firebaseAuth } from "@/config/firebase";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function getAuthHeaders(requireAuth: boolean): Promise<Record<string, string>> {
  if (!requireAuth) return {};

  const currentUser = firebaseAuth?.currentUser;
  if (!currentUser) {
    throw new ApiError(401, "Debes iniciar sesión para realizar esta operación.");
  }

  const token = await currentUser.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: BodyInit | Record<string, unknown>;
  requireAuth?: boolean;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${env.apiBaseUrl}${normalizedPath}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, requireAuth = false, query } = options;
  const authHeaders = await getAuthHeaders(requireAuth);

  const isFormData = body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...authHeaders,
  };

  let serializedBody: BodyInit | undefined;
  if (body !== undefined) {
    if (isFormData) {
      serializedBody = body;
    } else if (typeof body === "string") {
      serializedBody = body;
    } else {
      headers["Content-Type"] = "application/json";
      serializedBody = JSON.stringify(body);
    }
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: serializedBody,
    });
  } catch {
    throw new ApiError(
      0,
      "No se pudo conectar con el servidor API. Verifica que el backend FastAPI esté activo."
    );
  }

  if (!response.ok) {
    let detail = `Error del servidor (${response.status})`;
    try {
      const errJson = await response.json();
      if (typeof errJson?.detail === "string") {
        detail = errJson.detail;
      } else if (Array.isArray(errJson?.detail)) {
        detail = errJson.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ");
      }
    } catch {
      // keep fallback detail
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function apiFetchBlob(
  path: string,
  options: { requireAuth?: boolean; query?: RequestOptions["query"] } = {}
): Promise<{ blob: Blob; contentDisposition: string | null }> {
  const authHeaders = await getAuthHeaders(options.requireAuth ?? true);
  const response = await fetch(buildUrl(path, options.query), {
    method: "GET",
    headers: authHeaders,
  });

  if (!response.ok) {
    throw new ApiError(response.status, "No se pudo obtener la imagen del pedido.");
  }

  return {
    blob: await response.blob(),
    contentDisposition: response.headers.get("Content-Disposition"),
  };
}
