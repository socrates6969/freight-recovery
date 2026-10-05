import { keystore } from "./keystore";
import type { AnalysisList, AnalysisRecord, AnalysisResponse, Perspective } from "./types";

/** Empty -> same-origin "/api" (Vite dev proxy or a reverse proxy). Else an absolute origin. */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Client-safe text per status; server detail is shown only for 413/422 where it is a fixed string. */
function describe(status: number, detail: unknown): string {
  if (status === 401) return "No API key presented. Enter a key on the API key tab.";
  if (status === 403) return "The API key was rejected (invalid, revoked or tenant inactive).";
  if (status === 404) return "Not found.";
  if (status === 413) return typeof detail === "string" ? detail : "Upload too large.";
  if (status === 422)
    return typeof detail === "string" ? detail : "The submitted documents could not be processed.";
  if (status === 503) return "The server is busy or temporarily unavailable; retry shortly.";
  return `Request failed (HTTP ${status}).`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = keystore.get();
  const headers = new Headers(init.headers);
  if (key) headers.set("X-API-Key", key);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Could not reach the API. Is it running, and is the base URL right?");
  }
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = ((await res.json()) as { detail?: unknown }).detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, describe(res.status, detail));
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ status: string; version: string }>("/health"),
  analyze(files: File[], perspective: Perspective): Promise<AnalysisResponse> {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("perspective", perspective);
    return request<AnalysisResponse>("/v1/analyze", { method: "POST", body: form });
  },
  list: (limit = 50, offset = 0) =>
    request<AnalysisList>(`/v1/analyses?limit=${limit}&offset=${offset}`),
  get: (id: string) => request<AnalysisRecord>(`/v1/analyses/${encodeURIComponent(id)}`),
};
