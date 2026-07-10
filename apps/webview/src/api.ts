const TOKEN_KEY = "intelacraft_token";
const PI_SESSION_KEY = "intelacraft_pi_session";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function getPiSessionId(): string | null {
  return localStorage.getItem(PI_SESSION_KEY);
}

export function setPiSessionId(id: string): void {
  localStorage.setItem(PI_SESSION_KEY, id);
}

export function clearPiSessionId(): void {
  localStorage.removeItem(PI_SESSION_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? "HTTP_ERROR",
      json?.error?.message ?? `Request failed (${res.status})`,
      json,
    );
  }
  return json as T;
}
