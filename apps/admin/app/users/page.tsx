"use client";

import { useState } from "react";

// AC-06 (S09). Same self-contained pattern as ../catalog/page.tsx (no
// console shell/session yet — AC-M5-0 is a later, separate M5 task): its own
// login, its own api() helper reading NEXT_PUBLIC_API_URL. There is no
// list-users endpoint in 40-admin-center/05-api-specification.md §8
// (EP-AC-050..054 covers provision/grant/status, not listing) — "manage an
// existing user" below takes an identity id directly rather than a picker,
// an honest reflection of what the backend actually exposes.

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}`, "content-type": "application/json" }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? `${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function LoginForm({ onLoggedIn }: { onLoggedIn: (token: string) => void }) {
  const [email, setEmail] = useState("superadmin.seed@petrospecial.internal");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Login failed");
      onLoggedIn(body.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 360, display: "grid", gap: 12 }}>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ display: "block", width: "100%" }} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
      </label>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      <button type="submit">Sign in</button>
    </form>
  );
}

interface ProvisionResult {
  identityId: string;
  role: string;
  status: string;
  activationLink?: string;
}

function ProvisionForm({ token, kind, endpoint }: { token: string; kind: string; endpoint: string }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const res = await api<ProvisionResult>(endpoint, token, {
        method: "POST",
        body: JSON.stringify({ fullName, email, phone })
      });
      setResult(res);
      setFullName("");
      setEmail("");
      setPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 420, marginBottom: 16 }}>
      <h3 style={{ margin: 0 }}>Provision {kind}</h3>
      <input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input placeholder="Phone (+966...)" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      <button type="submit">Create</button>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {result && (
        <div style={{ fontSize: 13, background: "var(--bg-warm)", padding: 8, borderRadius: 6 }}>
          <p>
            Created: <code>{result.identityId}</code> ({result.role}, {result.status})
          </p>
          {result.activationLink && <p style={{ wordBreak: "break-all" }}>Activation link: {result.activationLink}</p>}
        </div>
      )}
    </form>
  );
}

function ManageUserForm({ token }: { token: string }) {
  const [identityId, setIdentityId] = useState("");
  const [role, setRole] = useState("driver");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function grant(action: "grant" | "revoke") {
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ roles: string[] }>(`/api/v1/admin/users/${identityId}/grants`, token, {
        method: "POST",
        body: JSON.stringify({ role, action })
      });
      setMessage(`Roles now: ${res.roles.join(", ")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function setStatus(status: "suspended" | "active") {
    setError(null);
    setMessage(null);
    const reason = window.prompt(`Reason for setting status to "${status}"?`) ?? "";
    if (!reason) return;
    try {
      const res = await api<{ status: string }>(`/api/v1/admin/users/${identityId}/status`, token, {
        method: "POST",
        body: JSON.stringify({ status, reason })
      });
      setMessage(`Status now: ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
      <h3 style={{ margin: 0 }}>Manage existing user</h3>
      <input placeholder="Identity id (uuid)" value={identityId} onChange={(e) => setIdentityId(e.target.value)} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="customer">customer</option>
          <option value="supplier">supplier</option>
          <option value="driver">driver</option>
          <option value="admin">admin</option>
          <option value="super_admin">super_admin</option>
        </select>
        <button type="button" onClick={() => grant("grant")} disabled={!identityId}>
          Grant role
        </button>
        <button type="button" onClick={() => grant("revoke")} disabled={!identityId}>
          Revoke role
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => setStatus("suspended")} disabled={!identityId}>
          Suspend
        </button>
        <button type="button" onClick={() => setStatus("active")} disabled={!identityId}>
          Reactivate
        </button>
      </div>
      {message && <p style={{ color: "#1a7f4e" }}>{message}</p>}
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
    </div>
  );
}

export default function AdminUsersPage() {
  const [token, setToken] = useState<string | null>(null);

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h1>User management (AC-06)</h1>
      {!token && <LoginForm onLoggedIn={setToken} />}
      {token && (
        <>
          <ProvisionForm token={token} kind="supplier" endpoint="/api/v1/admin/users/suppliers" />
          <ProvisionForm token={token} kind="driver" endpoint="/api/v1/admin/users/drivers" />
          <ProvisionForm token={token} kind="admin (super-admin only)" endpoint="/api/v1/admin/users/admins" />
          <ManageUserForm token={token} />
        </>
      )}
    </main>
  );
}
