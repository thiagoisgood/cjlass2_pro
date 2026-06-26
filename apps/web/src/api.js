const configuredBase = import.meta.env.VITE_API_BASE_URL;
export const API_BASE_URL = configuredBase || "/api/v1";
const AUTH_STORAGE_KEY = "cjlass2-auth-session";

let authSession = readStoredSession();

async function request(path, options = {}) {
  const { headers, ...requestOptions } = options;
  const authHeaders = authSession?.token ? { authorization: `Bearer ${authSession.token}` } : {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...requestOptions,
    headers: {
      "content-type": "application/json",
      ...authHeaders,
      ...(headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401) {
      clearAuthSession();
    }
    const error = new Error(text || `API request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) {
    return response.text();
  }
  return response.json();
}

export function getAuthSession() {
  return authSession;
}

export function setAuthSession(session) {
  authSession = session;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession() {
  authSession = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function readStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mutation(path, body = {}, options = {}) {
  const idempotencyKey = body.idempotencyKey || options.idempotencyKey || makeIdempotencyKey(path, body);
  return request(path, {
    method: options.method || "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ ...body, idempotencyKey }),
  });
}

function makeIdempotencyKey(path, body) {
  const stablePart = body.orderId || body.lessonId || body.id || body.expectedVersion || "";
  if (stablePart) {
    return `${path}:${stablePart}`;
  }
  if (globalThis.crypto?.randomUUID) {
    return `${path}:${globalThis.crypto.randomUUID()}`;
  }
  return `${path}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export const api = {
  login: async (body) => {
    const session = await request("/auth/login", { method: "POST", body: JSON.stringify(body) });
    setAuthSession(session);
    return session;
  },
  session: () => request("/auth/session"),
  snapshot: () => request("/snapshot"),
  dashboard: () => request("/dashboard"),
  reports: () => request("/reports/summary"),
  lessonLedgerSummary: () => request("/lesson-ledger/summary"),
  paymentLedgerSummary: () => request("/payment-ledger/summary"),
  createStudent: (body) => mutation("/students", body),
  createLesson: (body) => mutation("/lessons", body),
  createOrder: (body) => mutation("/orders", body),
  createNotification: (body) => mutation("/notifications", body),
  updateNotification: (id, body) => mutation(`/notifications/${id}`, body, { method: "PATCH" }),
  sendNotification: (id) => mutation(`/notifications/${id}/send`, { id }),
  sendAllNotifications: () => mutation("/notifications/send-all"),
  scheduleNotification: (id, scheduledFor) => mutation(`/notifications/${id}/schedule`, { id, scheduledFor }),
  generateDunningDrafts: () => mutation("/notifications/dunning-drafts"),
  recordPayment: (orderId) => mutation("/payments", { orderId }),
  markAttendance: (lessonId, status) => mutation("/attendance", { lessonId, status }),
  proposeSchedule: (body) => mutation("/schedule/proposals", body),
  confirmTask: (id, expectedVersion) => mutation(`/business-tasks/${id}/confirm`, { id, expectedVersion }),
  cancelTask: (id, expectedVersion) => mutation(`/business-tasks/${id}/cancel`, { id, expectedVersion }),
  interpretCommand: (body) => mutation("/commands/interpret", body),
  reset: () => mutation("/dev/reset"),
  exportCsv: async (type) => {
    const csv = await request(`/exports/${type}`);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${type}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return csv;
  },
};
