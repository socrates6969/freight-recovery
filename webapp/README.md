# Freight Recovery pilot dashboard (webapp)

Pilot front-end for the Freight Recovery FastAPI service. **Pre-product. DRAFT output. Synthetic data
only. Not deployed anywhere.** It is the reference the product UI is meant to be replicated from.

## Stack choice (pinned)

Vite 6 + React 19 + TypeScript 5 (strict), Vitest + Testing Library for tests. Chosen over a plain
static page because the evidence packet is structured, the key/state handling benefits from a typed
store, and React's default text escaping gives XSS-safe rendering for free. Zero runtime
dependencies beyond `react` and `react-dom`; all versions are exact-pinned in `package.json`
and locked in `package-lock.json`.

## Run it against the local API

```bash
# 1. API (repo root): needs FR_* settings, see the repo README. Dev: FR_ENVIRONMENT=dev
python -m freight_recovery.admin create-tenant "Synthetic Co"
python -m freight_recovery.admin issue-key "Synthetic Co" --label ui   # key shown ONCE
uvicorn freight_recovery.api.main:app --host 127.0.0.1 --port 8000

# 2. UI
cd webapp
npm ci
cp .env.example .env.local     # optional
npm run dev                    # http://127.0.0.1:5173
```

The API sends no CORS headers, so in dev Vite proxies `/api/*` to `VITE_API_PROXY_TARGET`
(default `http://127.0.0.1:8000`). Paste the key on the **API key** tab, then upload synthetic
documents on **Analyze**; **History** lists past analyses.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | dev server, loopback only |
| `npm run build` | typecheck + production build to `dist/` (strict CSP injected) |
| `npm test` | component and API-contract tests (no network) |
| `npm run audit` | `npm audit --omit=dev` (runtime dependencies) |

Build config: `VITE_API_BASE_URL` (absolute API origin, also added to the CSP `connect-src`; empty
means same-origin `/api`). To serve a build, front it and the API with a reverse proxy, or set
the API origin and add CORS on the API side (a decision for the operator, not made here).
`public/_headers` documents the full header set (incl. `frame-ancestors`, which a `<meta>` CSP
cannot carry); replace the placeholder API origin before use.

## Front-end threat model (brief)

| Threat | Mitigation | Residual |
|---|---|---|
| Key theft from storage | Key held in module memory only; never localStorage/sessionStorage/cookies/URL; input is `type=password`, cleared on submit; "Forget key" | XSS in this origin could still read memory; a reload loses the key (intended) |
| XSS via API/user content (filenames, findings, letter text) | All content rendered as React text nodes; no `dangerouslySetInnerHTML`/`innerHTML`; test asserts hostile strings stay inert | Dependency compromise |
| Script injection / exfiltration | CSP: `default-src 'none'`, `script-src 'self'`, no inline scripts or handlers, `connect-src` = self + API origin only, `base-uri 'none'`, `form-action 'none'` | Meta CSP lacks `frame-ancestors`; set via headers (`_headers`) |
| Clickjacking, referrer/permission leakage | `X-Frame-Options`, `frame-ancestors`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (in `_headers`; dev server sets nosniff/referrer) | Depends on host applying the headers |
| Ambient-credential CSRF | Auth is a custom header (`X-API-Key`), `credentials: "omit"`, no cookies | - |
| Supply chain | Exact pins + lockfile; `npm audit --omit=dev` clean (0). Dev-only: 2 moderate advisories in `vitest`'s `@vitest/mocker` (redirect-mock path traversal in the test runner; we use no module mocks and never run it on untrusted input). Fix needs a breaking vitest major; deferred and documented | Re-audit regularly |
| Server error leakage | Client shows fixed messages per HTTP status | - |
| Real customer data | UI banner and docs forbid it; backend gaps (audit, malware scan, retention) are listed in the repo README | Do not upload real data |

Not covered: rate limiting/WAF (server side), SSO/user accounts (the key is a tenant credential, not a user
login), a third-party pentest.

## Notes

- Keys are issued by the operator CLI and shown once; the UI cannot create or recover keys.
- `index.html` is `noindex`. Nothing is sent to any third party; no analytics.
