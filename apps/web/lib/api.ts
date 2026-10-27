import type {
  LoginResponse,
  PublicAlert,
  PublicGroup,
  PublicTemplate,
  PublicUser,
} from "@bcp/shared";

const DEFAULT_API_URL = "http://localhost:3001";

export function getApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || DEFAULT_API_URL
  );
}

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
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    `${getApiBaseUrl()}/`,
  );
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
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

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

export type PublicMember = {
  id: string;
  displayName: string;
  active: boolean;
  contactBasis: string;
  contactBasisAt: string;
  userId: string | null;
  phones: Array<{
    id: string;
    e164: string;
    countryCode: string;
    active: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryItem = {
  id: string;
  channel: string;
  status: string;
  targetAddress: string;
  recipientUserId: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
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

  listMembers: (token: string, query?: { q?: string; page?: number }) =>
    apiRequest<Paginated<PublicMember>>("/members", { token, query }),

  createMember: (
    token: string,
    body: {
      displayName: string;
      e164: string;
      countryCode?: string;
      contactBasis?: string;
    },
  ) =>
    apiRequest<{ member: PublicMember }>("/members", {
      method: "POST",
      token,
      body,
    }),

  updateMember: (
    token: string,
    id: string,
    body: { displayName?: string; active?: boolean },
  ) =>
    apiRequest<{ member: PublicMember }>(`/members/${id}`, {
      method: "PATCH",
      token,
      body,
    }),

  deactivateMember: (token: string, id: string) =>
    apiRequest<{ member: PublicMember }>(`/members/${id}/deactivate`, {
      method: "POST",
      token,
    }),

  listGroups: (token: string, query?: { q?: string; page?: number }) =>
    apiRequest<Paginated<PublicGroup>>("/groups", { token, query }),

  getGroup: (token: string, id: string) =>
    apiRequest<{ group: PublicGroup }>(`/groups/${id}`, { token }),

  createGroup: (
    token: string,
    body: { name: string; description?: string },
  ) =>
    apiRequest<{ group: PublicGroup }>("/groups", {
      method: "POST",
      token,
      body,
    }),

  updateGroup: (
    token: string,
    id: string,
    body: { name?: string; description?: string | null },
  ) =>
    apiRequest<{ group: PublicGroup }>(`/groups/${id}`, {
      method: "PATCH",
      token,
      body,
    }),

  listGroupMembers: (token: string, id: string) =>
    apiRequest<Paginated<PublicMember> & { groupId: string }>(
      `/groups/${id}/members`,
      { token },
    ),

  addGroupMembers: (token: string, id: string, memberIds: string[]) =>
    apiRequest<{ group: PublicGroup }>(`/groups/${id}/members`, {
      method: "POST",
      token,
      body: { memberIds },
    }),

  removeGroupMember: (token: string, id: string, memberId: string) =>
    apiRequest<{ group: PublicGroup }>(`/groups/${id}/members/${memberId}`, {
      method: "DELETE",
      token,
    }),

  listTemplates: (token: string) =>
    apiRequest<Paginated<PublicTemplate>>("/templates", {
      token,
      query: { active: "true", limit: 100 },
    }),

  listAlerts: (
    token: string,
    query?: { state?: string; page?: number; limit?: number },
  ) => apiRequest<Paginated<PublicAlert>>("/alerts", { token, query }),

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
    apiRequest<{ alert: PublicAlert; idempotent: boolean }>("/alerts", {
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
