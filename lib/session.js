// lib/session.js — browser-side session management.
//
// The short-lived access token lives ONLY in JS memory (never localStorage/sessionStorage),
// so an XSS payload can't lift a long-lived credential from storage. The long-lived
// refresh token is an httpOnly, SameSite=Strict cookie that JavaScript cannot read.
// After a page reload the access token is re-minted via POST /api/auth/refresh.

let accessToken = null;
let refreshPromise = null;

export class AuthError extends Error {}

export function setAccessToken(token) {
  accessToken = token;
}

function tokenExpiresInMs(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 - Date.now();
  } catch {
    return 0;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Single-flight refresh: concurrent callers share one network request. */
export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
        if (res.ok) {
          const data = await res.json();
          accessToken = data.accessToken;
          return accessToken;
        }
        // 409 = another tab rotated the cookie a moment ago; the browser now holds the
        // new cookie, so simply retry.
        if (res.status === 409) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        break;
      }
      accessToken = null;
      throw new AuthError("Session expired");
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Returns a token valid for at least another 30s, refreshing if needed. */
export async function ensureAccessToken() {
  if (accessToken && tokenExpiresInMs(accessToken) > 30000) return accessToken;
  return refreshAccessToken();
}

/**
 * fetch() wrapper: attaches the bearer token, refreshes once on 401, and JSON-encodes
 * plain-object bodies. Throws AuthError when the session is gone.
 */
export async function apiFetch(url, { body, headers = {}, ...opts } = {}) {
  const isJson = body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body);
  const send = (token) =>
    fetch(url, {
      ...opts,
      credentials: "same-origin",
      headers: {
        ...(isJson ? { "Content-Type": "application/json" } : {}),
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: isJson ? JSON.stringify(body) : body,
    });

  let res = await send(await ensureAccessToken());
  if (res.status === 401) res = await send(await refreshAccessToken());
  if (res.status === 401) throw new AuthError("Session expired");
  return res;
}

/** apiFetch + JSON parse; throws Error(message) on non-2xx. */
export async function apiJson(url, opts) {
  const res = await apiFetch(url, opts);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {}
  accessToken = null;
}
