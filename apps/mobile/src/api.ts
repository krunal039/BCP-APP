import type {
  LoginResponse,
  PublicAlert,
  PublicGroup,
  PublicTemplate,
  PublicUser,
} from "@bcp/shared";
import { getApiBaseUrl } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: string;
  token?: string | null;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const base = getApiBaseUrl().replace(/\/$/, "");
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${base}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string"
        ? (data as { message: string }).message
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type DeliveryItem = {
  id: string;
  channel: string;
  status: string;
  targetAddress: string;
  providerMessageId: string | null;
  errorCode: string | null;
};

export const api = {
  login: (username: string, password: string) =>
    apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: { username, password },
    }),
  me: (token: string) =>
    apiRequest<{ user: PublicUser }>("/auth/me", { token }),
  logout: (token: string) =>
    apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST", token }),
  listGroups: (token: string) =>
    apiRequest<Paginated<PublicGroup>>("/groups", {
      token,
      query: { limit: 100 },
    }),
  listTemplates: (token: string) =>
    apiRequest<Paginated<PublicTemplate>>("/templates", {
      token,
      query: { active: "true", limit: 100 },
    }),
  listAlerts: (token: string, query?: { state?: string; limit?: number }) =>
    apiRequest<Paginated<PublicAlert>>("/alerts", { token, query }),
  getAlert: (token: string, id: string) =>
    apiRequest<{ alert: PublicAlert }>(`/alerts/${id}`, { token }),
  composeAlert: (
    token: string,
    body: {
      templateId?: string;
      body?: string;
      severity?: string;
      groupIds: string[];
      submitForApproval?: boolean;
      idempotencyKey?: string;
    },
  ) =>
    apiRequest<{ alert: PublicAlert }>("/alerts", {
      method: "POST",
      token,
      body,
    }),
  composeAndBypass: (
    token: string,
    body: {
      templateId?: string;
      body?: string;
      severity?: string;
      groupIds: string[];
      reason: string;
      idempotencyKey?: string;
    },
  ) =>
    apiRequest<{ alert: PublicAlert }>("/alerts/bypass", {
      method: "POST",
      token,
      body,
    }),
  approveAlert: (token: string, id: string) =>
    apiRequest<{ alert: PublicAlert }>(`/alerts/${id}/approve`, {
      method: "POST",
      token,
    }),
  rejectAlert: (token: string, id: string, note?: string) =>
    apiRequest<{ alert: PublicAlert }>(`/alerts/${id}/reject`, {
      method: "POST",
      token,
      body: note ? { note } : {},
    }),
  bypassAlert: (token: string, id: string, reason: string) =>
    apiRequest<{ alert: PublicAlert }>(`/alerts/${id}/bypass`, {
      method: "POST",
      token,
      body: { reason },
    }),
  listDeliveries: (token: string, id: string) =>
    apiRequest<{ alertId: string; items: DeliveryItem[] }>(
      `/alerts/${id}/deliveries`,
      { token },
    ),
};
