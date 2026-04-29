import type { DashboardSummary } from '../pipelineTypes';

const STORAGE_KEY = 'swiftpay_pipeline_jwt';

/** Base URL for API. Empty = same origin (Vite proxies `/v1` → API in dev). */
export function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
}

export function getPipelineJwt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setPipelineJwt(token: string | null): void {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token.trim());
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function apiFetch(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const url = `${apiBase()}${path}`;
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const jwt = getPipelineJwt();
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  return fetch(url, { ...init, headers, body });
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const res = await apiFetch('/v1/dashboard/summary', { method: 'GET' });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as DashboardSummary;
}

export async function postVerificationRefresh(): Promise<{ ingestionRunId: string; status: string }> {
  const res = await apiFetch('/v1/verification/refresh', { method: 'POST', json: {} });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as { ingestionRunId: string; status: string };
}
