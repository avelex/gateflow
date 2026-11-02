export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/// JSON call to the relay on the same origin. Non-2xx replies throw `ApiError` with the relay's `{error}`.
export async function api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: object): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error ?? res.statusText);
  return json as T;
}
