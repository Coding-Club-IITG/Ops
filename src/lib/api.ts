const BASE_URL = "/api";

function buildQuery(params?: Record<string, unknown>) {
  if (!params) return "";

  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.append(key, String(value));
    }
  });

  return `?${query.toString()}`;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  params?: Record<string, unknown>,
) {
  const url = `${BASE_URL}${path}${buildQuery(params)}`;

  const res = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.assign(
        `/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      );
    }
    throw new Error(`API Error: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}
