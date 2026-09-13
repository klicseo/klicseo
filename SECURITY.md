# Security & Data Protection

This document describes the protection in place for customer and employee data
in the Klicseo admin platform, where each protection lives in the stack, and
the threat models it addresses.

If you are a customer or auditor, this is the canonical reference. If you are
a developer changing the auth or data flow, please update this file alongside
your change.

---

## At-rest encryption — handled by Supabase

The production database is **Supabase managed Postgres**, which encrypts every
disk at rest with **AES-256** using keys held by AWS KMS. This protects against
physical-media theft and unauthorised access to the underlying storage. We do
nothing additional at the storage layer because the platform already does it
correctly.

**Backups** taken by Supabase (point-in-time recovery + daily snapshots) are
encrypted with the same KMS-managed keys.

## In-transit encryption — TLS everywhere

- App ↔ Database: every connection from this Next.js app uses the official
  `@supabase/supabase-js` client, which forces **TLS 1.2+** to Supabase's
  pooler and direct connections.
- Browser ↔ App: served over HTTPS in production (deployment platform
  responsibility — Vercel/Netlify/your reverse proxy must terminate TLS).
- Admin email/invite/reset flows use Supabase Auth's SMTP, also TLS-encrypted.

## Authentication

### Customer / public booking
- The public booking flow does **not** authenticate users — bookings are
  treated as leads, validated server-side at `/api/booking/route.ts`, and
  written under the service role.

### Admin
Three-layer model:

1. **Supabase Auth** — admins log in with email + password (`signInWithPassword`).
   Passwords are stored only by Supabase Auth (bcrypt-hashed by Supabase, never
   handled by application code).
2. **Allowlist** — `public.admin_users` row must have `status='active'`. The
   environment-pinned super-admin (`SUPER_ADMIN_EMAIL`) is implicit and cannot
   be revoked from the UI.
3. **Session cookie** — on successful login we mint an HMAC-SHA256 signed
   cookie (`expiry.email_b64.signature`) keyed by `ADMIN_COOKIE_SECRET`. The
   cookie is `httpOnly`, `secure` (in production), `SameSite=Lax`. Tampering
   the cookie (different email or expiry) fails the signature check.
   Rotating `ADMIN_COOKIE_SECRET` invalidates every active session.

`currentAdmin()` re-checks the allowlist on every request (cached per request
via React's `cache()`), so revoking / blocking / role-changing a user takes
effect on their next request without waiting for the cookie to expire.

### Forced sign-out
`admin_users.signed_out_after timestamptz` is consulted on every session check;
if the cookie was issued before this timestamp the session is treated as
expired. A polled `/api/admin/whoami` from every admin page also propagates
forced sign-outs to live tabs within ~5 seconds.

## Authorisation

- **Roles**: `super_admin`, `admin`, `staff`.
- **Permissions** (granular, only consulted for staff): `leads.view`,
  `leads.manage`, `employees.view`, `employees.manage`, `payments.view`,
  `payments.manage`.
- Admins and super-admins implicitly hold every permission. Only super-admins
  have unrestricted row visibility; regular admins and staff use assigned scope.
  Payments enforce that scope on reads, exports, and saves. Global allocation
  and reassignment require the super-admin role.
- Every server action calls `requirePermission(perm)` (or the equivalent
  role check) before mutating data.
- Row-level security (RLS) is enabled on every table. Public-read tables
  (`service_categories`, `service_options`, `service_price_lines`,
  `price_tier_amounts`, `price_tiers` metadata) have explicit `for select
  using (true)` policies. **All writes route through the service-role key**
  (never exposed to the browser).

## Service-role key — strict server-only handling

- `SUPABASE_SERVICE_ROLE_KEY` is read only in modules that import
  `"server-only"` at the top. The `server-only` package fails the build if any
  client component imports such a module, so the key cannot leak to the
  browser bundle.
- All DB-mutation code lives in `src/lib/*.ts` files marked `"server-only"`.

## Audit trail

Every admin write action is recorded to `audit_logs` (action, actor email,
entity, summary, optional before/after JSON, computed diff). The logs:
- Cover leads, employees, jobs, cars, tiers, discounts, bookings, site
  settings, message templates, access changes, force-logouts, and
  authentication events.
- Retain 6 months automatically (opportunistic prune on writes + on every
  logs-page view + an optional `pg_cron` schedule).
- Are exportable as date-range CSV by admins.

## Application-layer field encryption

In addition to Supabase's disk-level AES-256, a chosen subset of fields is
**also** encrypted at the application layer using AES-256-GCM with a key only
the app server holds (`APP_ENCRYPTION_KEY`, 32 bytes hex). The DB sees only
ciphertext for these fields — even a leaked DB dump or a service-role key
compromise can't read them without also stealing the encryption key.

**Encrypted columns** (server seals on write, unseals on read):

| Table | Column | What it holds |
| --- | --- | --- |
| `leads` | `phone` | Customer phone (HMAC sibling in `phone_hash`) |
| `leads` | `car_number` | License plate |
| `leads` | `address` | Customer's home address |
| `leads` | `map_link` | Google Maps URL with exact GPS |
| `leads` | `gate_access_notes` | Gate code / doorman / access notes |
| `leads` | `notes` | Free-text internal notes |
| `employees` | `phone` | Employee phone (HMAC sibling in `phone_hash`) |
| `employees` | `aadhaar_number` | Government ID |
| `employees` | `notes` | Free-text internal notes |
| `payments` | `notes` | Free-text payment notes |
| `audit_logs` | `metadata` | Before/after snapshots of all the above |

**Phone search**: encrypted phones can't be `ILIKE`'d, so we keep a sibling
`phone_hash` column = HMAC-SHA256 of the normalised digits (last 10), keyed
by `APP_ENCRYPTION_KEY` with a `"phone-hash-v1:"` domain tag. Searching by a
full phone number in the admin search box continues to work; lead and employee search also supports partial phones by decrypting scoped
rows on the server before matching. Brute-forcing the hash space requires also stealing the encryption
key, at which point the attacker can decrypt the phone directly.

**Wire format**: `enc:v1:` prefix + base64( IV(12B) | tag(16B) | ciphertext ).
The prefix makes ciphertext distinguishable from legacy plaintext so the
one-shot backfill (`POST /api/admin/encrypt-backfill`) is idempotent.

**Key management**:
- `APP_ENCRYPTION_KEY` is read once at startup, held in memory, never logged.
- Lives in the deploy platform's environment-variable store, alongside
  `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_COOKIE_SECRET`.
- **Losing the key permanently bricks every encrypted field.** Back it up
  the same way you back up other production secrets.
- **Rotating the key requires re-encrypting every row.** Run an offline
  re-encryption job before swapping the env var.

**Performance**: AES-GCM is ~1 GB/s/core. Cost per lead detail page is on the
order of 100 µs — imperceptible.

## Confidential fields — what is NOT additionally encrypted (and why)

These remain plaintext because they're load-bearing for searches, sorts,
aggregates, or routing:

- **Lead / Employee**: `name` — used by admin search ILIKE; encrypting it
  would force a similar hash-column treatment as phone but search by
  partial name is a daily operation.
- **Lead**: `latitude`, `longitude` — numeric, used by the server-side
  radius check on every booking submit. Encrypting requires a column-type
  change (numeric→text).
- **Employee**: `salary` — numeric, used in sorts/aggregates.
- **Payment**: `amount`, `method`, `status`, `paid_at` — used in totals,
  filters, and date math.
- **Admin allowlist**: `email`, `role`, `permissions` — `email` is the
  primary lookup key.
- **Operational metadata**: dates, status enums, pincode, parking_location,
  service_option, vehicle_type — low-PII operational data used in filters.

If a customer-specific compliance regime (HIPAA, PCI, certain GDPR scenarios)
requires these encrypted too, the lift is significant: each searchable field
needs a parallel deterministic-encryption or hash column to keep search
working. The seal/unseal scaffolding in `src/lib/crypto.ts` is the entry
point for that work.

## Network surfaces

- `/api/booking` — public POST. Rate limiting is the deployment platform's
  responsibility today.
- `/api/cars/search` — public GET (used by the booking type-ahead). Returns
  only car catalog data.
- `/api/site-settings` — public GET. Returns the same data the marketing site
  renders publicly; no sensitive content.
- `/api/admin/*` — every route checks `currentAdmin()` and returns 401/403
  on failure.

## Operational guidance

### Secrets management
The following environment variables must be set in production and rotated on
team changes:

| Variable | Purpose | Rotate when |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | App connects to your Supabase project | n/a (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon access (RLS gates everything) | annually or on suspicion |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes; bypasses RLS | annually, after any team departure, on suspicion |
| `ADMIN_COOKIE_SECRET` | HMAC key for admin sessions | annually, after any team departure — invalidates all admin sessions |
| `APP_ENCRYPTION_KEY` | AES-256-GCM key for field-level encryption (`openssl rand -hex 32`) | annually or on suspicion — **requires re-encrypting every row first** |
| `SUPER_ADMIN_EMAIL` | Implicit super-admin | review when ownership changes |
| SMTP credentials | Invite / reset emails | per provider policy |

Never commit secrets to git. `.env.local` is gitignored; production secrets
live in the deployment platform's environment settings.

### Account hygiene
- Use `Force logout` (per-user) or `Sign out all` (bulk) on the Team page
  after a device is lost or before any major access review.
- Use `Block` to suspend a user without losing their permission set. Use
  `Remove` to delete the row plus the Supabase auth user.
- Demote admins to staff (and re-grant explicit permissions) rather than
  giving long-lived admin access to anyone whose role doesn't strictly need it.
- Review audit logs after any unexpected event; date-range CSV export is the
  channel for forensic analysis.

### Backups
Supabase manages daily snapshots + point-in-time recovery on paid plans.
Verify your project is on a plan that includes PITR if you depend on it.

### Reporting a security issue
If you believe you've found a vulnerability, do **not** open a public issue.
Email the operator at the address printed in the footer of the public site
with the subject `SECURITY` and a clear description. Acknowledgement within
72 hours.

---

## Quick summary

- **Disks** — encrypted by Supabase (AES-256).
- **Wire** — TLS 1.2+ everywhere.
- **Service-role key** — server-only, never in the browser bundle.
- **Auth** — Supabase password hash + app allowlist + HMAC session cookie.
- **Authz** — role + granular permission checks on every server action; RLS
  on every table; writes require the service role.
- **Audit** — every admin action logged with field-level before/after diffs,
  6-month retention, CSV export.
- **Operational kill-switches** — Force logout, Block, Remove, Demote;
  cookie-secret rotation invalidates every session.
