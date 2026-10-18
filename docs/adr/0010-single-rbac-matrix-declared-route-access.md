# ADR 0010: One frozen RBAC matrix in the shared package; every route declares its access

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-08 (`32e05b0` "@fr/shared - roles, permission matrix ...", `207479a` "RBAC enforcement")
- **Reconstructed from:** `packages/shared/src/rbac.ts`, `api/src/http/route.ts` (`defineRoute`,
  `enforceRouteAccess`), `api/src/http/security.ts`, threat model T6

## Context

With six tenant roles, two platform roles and a growing route list, the usual failure is a new route that
forgets its permission check, or a UI that shows a button the API would refuse. Both are cheap to prevent at the
framework level and expensive to find in review.

## Decision

- `rbac.ts` defines `TENANT_ROLES`, `PLATFORM_ROLES`, `PERMISSIONS` (30 today) and a frozen
  `PERMISSION_MATRIX`. The API calls `can(role, permission)` on every request; the web app imports the same data
  only to hide controls.
- Every route is registered through `defineRoute` with an `access` of `public`, `cookie-session`,
  `authenticated` or a named permission, optionally an `apiKeyScope`. The app refuses to boot if any route lacks
  a declaration.
- Authentication and permission checks run in the global `onRequest` hook before the body is parsed, so a
  forbidden caller gets 403 even for an invalid body. Denials are audited.
- Role assignment is rank-based: OWNER can never be assigned, and assigning ADMIN needs `admins:manage`.

## Consequences

- Adding a feature means adding a permission to one file and declaring it on the route; tests enumerate routes
  times roles (T-RBAC-01..08).
- There is no Team model, so a role grants its permissions across all of the tenant's claims (assumption A4).
- Platform roles carry no tenant permission by construction, which keeps staff out of customer data.
