# Klicseo

Customer-facing booking site and full admin back-office for a Chennai-based
doorstep car-wash and detailing business. Built on Next.js 16 (App Router) +
Supabase. This README is the orientation map — it covers the architecture,
conventions, and the few non-obvious things you need to know before changing
code. For day-2 operations and threat-model details, see
[`SECURITY.md`](./SECURITY.md). For AI-agent-specific guidance see
[`AGENTS.md`](./AGENTS.md).

---

## 1. What this app does

Three surfaces share one Next.js codebase:

| Surface | Audience | Entry routes |
| --- | --- | --- |
| **Marketing site** | Visitors browsing services + pricing | `/`, `/careers`, `/careers/[slug]` |
| **Booking wizard** | Customers placing orders | `/booking` |
| **Admin back-office** | Owner + staff | `/admin/*` |

The marketing site and booking wizard are rendered as the *same* application
(no separate front-end), so component reuse and shared types are the norm.

---

## 2. Tech stack

- **Next.js 16.2** (App Router, server components first, Turbopack).
- **React 19** with `useActionState`, `useTransition`, server actions.
- **TypeScript** everywhere. Strict mode.
- **Tailwind CSS v4** via `@import "tailwindcss"` in `src/app/globals.css`.
- **Supabase** for Postgres + Auth + Storage (`@supabase/supabase-js`).
- **react-icons/fa6** for brand icons (Instagram, WhatsApp, …); **lucide-react** for everything else.
- **framer-motion** for entrance animations.
- **react-markdown + remark-gfm** for admin-editable Terms & Conditions.
- **jszip** for full-DB ZIP exports.

> Heads-up: Next 16 has API/convention shifts from Next 14/15. If something
> looks wrong vs. your training data, **read `node_modules/next/dist/docs/`
> before improvising** (see `AGENTS.md`).

---

## 3. Top-level layout

```
src/
├── app/                     Next.js App Router routes
│   ├── page.tsx             Marketing home
│   ├── booking/             Customer booking flow
│   ├── careers/             Job postings + application
│   ├── admin/               Admin back-office (gated)
│   ├── api/                 Route handlers (booking POST, admin APIs)
│   ├── layout.tsx           Root layout — SiteSettingsProvider + DiscountProvider
│   └── globals.css          Tailwind + global rules (date-picker icons, etc.)
├── components/              Reusable UI (mostly client components)
├── lib/                     Server-side libs + client-safe -shared modules
└── ...
supabase/
├── migrations/              Numbered SQL migrations 0001 … 0042
├── email-templates/         Branded HTML for invite/recovery emails
└── ADMIN_AUTH_SETUP.md      Notes for setting up Supabase Auth + SMTP
public/                      Static assets
SECURITY.md                  Threat model + ops guidance
AGENTS.md                    Instructions for AI agents (Next 16 reminder)
CLAUDE.md                    Loads AGENTS.md for the Claude Code agent
```

### `src/lib/` conventions

- Every file that talks to the database starts with `import "server-only"`.
  This package fails the build if a client component accidentally imports it,
  which is the only thing stopping the service-role key from ending up in the
  browser bundle. **Don't remove these imports.**
- Server libs that need client counterparts (types, constants) pair with a
  `*-shared.ts` module — e.g. `leads.ts` ↔ `leads-shared.ts`,
  `priceTiers.ts` ↔ `priceTiers-shared.ts`. The shared file has no DB calls;
  it's safe to import from both server and client.
- Server libs re-export from their `-shared` sibling so existing imports
  from `@/lib/leads` continue to resolve everything.

---

## 4. Architecture in one screen

```
Browser
   │
   │ HTTPS
   ▼
Next.js (App Router)
   │
   ├── Server Components (DB reads, gated by currentAdmin / permissions)
   │      │
   │      ▼
   │   src/lib/*.ts   ── "server-only" ──▶ Supabase (service role)
   │                                          │
   │                                          ├── Postgres (RLS-on)
   │                                          ├── Auth (email/password)
   │                                          └── Storage (employee-docs, site-media)
   │
   ├── Server Actions (mutations, form POSTs, audit-logged)
   ├── Route Handlers (booking POST, admin APIs)
   └── Client Components (UI state, calls server actions)
```

### Two providers at the root layout

`src/app/layout.tsx` wraps every page in:

1. **`SiteSettingsProvider`** — holds the live `SiteSettings` (start price,
   phone, social, booking config, message templates, service radius, **the
   service catalog**, etc.). Polls `/api/site-settings` every 30 s + on tab
   focus, so admin edits propagate to live customer/admin tabs without a
   reload. See `src/components/SiteSettingsContext.tsx`.
2. **`DiscountProvider`** — per-line discount %, badge flags, plus a
   `byLineId` variant for catalog-aware lookups (admin-created options). See
   `src/components/DiscountContext.tsx`.

Most "live across tabs" behaviour falls out of these two contexts.

---

## 5. The service catalog (most important domain concept)

Three nested entities, each fully admin-editable in `/admin/booking → Step 1`:

```
service_categories       ──┬── service_options    ──┬── service_price_lines
  e.g. "Subscription      │   e.g. "Monthly",       │   e.g. "monthly"
  Car Wash"               │   "Weekly Thrice"       │   ("base"), "outside_monthly"
                          │                         │   ("outside"), "interior"
                          │                         │   ("addon" — category-level)
                          ▼                         ▼
                       cars.tier_id      price_tier_amounts(tier_id, line_id, amount)
```

- Tier-only pricing for cars: a car has no own price columns — it points at
  a `price_tiers` row whose `price_tier_amounts` row-per-line carries the
  numbers. See migrations `0018` → `0021`.
- Categories and options have `legacy_id` / `legacy_key` fields so the
  hard-coded enums in `src/lib/pricing.ts` still resolve. New admin-created
  options use the `slug` as their stable identifier (no legacy id).
- `pricing.ts` is the source of truth for the **hard-coded** option enum,
  per-tier static prices, and which line is the base/outside/addon for a
  legacy option. `carPricing.ts` does the price math; it has two paths:
  `carPriceFor()` for legacy options and `carPriceForCatalog()` for
  admin-created options (resolves lines from the catalog at call time).

The "shared" module pattern means types live in `serviceCatalog-shared.ts`;
server fetchers live in `serviceCatalog.ts`.

---

## 6. Database schema (chronological migration map)

Numbered files in `supabase/migrations/`. Each migration is idempotent and
self-contained:

| # | File | What it adds |
| --- | --- | --- |
| 0001-0003 | initial | `leads`, basic auth, RLS scaffolding |
| 0004 | cars | `cars` table with legacy 9 price columns |
| 0005 | search_cars | Fuzzy-match RPC using `pg_trgm` |
| 0006 | admin_users | Allowlist, roles, granular permissions |
| 0007-0010 | service_discounts | Per-line % + badge toggle |
| 0011-0012 | jobs | Careers section + application-field config |
| 0013 | site_media | Hero + package videos/images |
| 0014 | lead custom_fields | Admin-defined extra fields on bookings |
| 0015 | payments | Monthly tracking for booked customers |
| 0016 | audit_logs | All admin actions logged |
| 0017 | audit retention | Auto-prune older than 6 months |
| 0018 | price_tiers | Tier table, cars get `tier_id` |
| 0019 | dynamic_services | Catalog tables — categories, options, lines, amounts |
| 0020 | drop legacy car prices | Remove 9 price columns from `cars` |
| 0021 | drop legacy tier prices | Remove 9 price columns from `price_tiers`; `price_tier_amounts` becomes truth |
| 0022 | dynamic_discounts | `service_discounts.line_id` FK, auto-create trigger |
| 0023 | admin_signed_out_after | Force-logout support |
| 0024 | phone_hash | Searchable HMAC sibling for encrypted phones |
| 0025 | lead_area | `leads.area` + Chennai `pincode_areas` seed |

### Key tables you'll touch most

- **`leads`** — customer enquiries + bookings. Many sensitive columns
  encrypted at rest (see § 8).
- **`employees`** — staff records, aadhaar + notes encrypted.
- **`price_tiers`** + **`price_tier_amounts`** — pricing source of truth.
- **`service_categories`/`_options`/`_price_lines`** — the dynamic catalog.
- **`payments`** — one row per (lead_id, period); notes encrypted.
- **`app_settings`** — key/value JSON for everything site-config-ish (start
  price, social links, booking config, service radius, message templates).
- **`audit_logs`** — `metadata` column is encrypted (`{ "__sealed": "enc:v1:..." }`).
- **`admin_users`** — email/role/permissions + `signed_out_after` for force-logout.

RLS is enabled on every table. Public-read tables (`cars`,
`service_categories`, `service_options`, `service_price_lines`,
`price_tier_amounts`, `pincode_areas`) have `for select using (true)`. **All
writes route through the service-role key, never from the browser.**

---

## 7. Auth & access control

- Admins sign in via Supabase Auth (`signInWithPassword`), then the app
  mints its own HMAC-signed cookie keyed by `ADMIN_COOKIE_SECRET`.
- `currentAdmin()` in `src/lib/admin-auth.ts` is React-cached per request; it
  re-checks the allowlist and `signed_out_after` on every call.
- Three roles: `super_admin`, `admin`, `staff`. Staff have granular
  permissions (`leads.view`, `leads.manage`, `employees.view`,
  `employees.manage`, `payments.view`, `payments.manage`).
- `requirePermission("leads.manage")` is the standard gate for server
  actions.
- The `AuthSessionGuard` (`src/app/admin/AuthSessionGuard.tsx`) polls
  `/api/admin/whoami` every 5 s on every admin page so force-logouts
  propagate to live tabs.
- All four kill-switches live on `/admin/access`:
  - **Force logout** — invalidates the session
  - **Block** — suspends without deleting
  - **Demote** — admin → staff (strips role + permissions)
  - **Remove** — deletes allowlist row + Supabase auth user

See `SECURITY.md` § 7 for the full auth/authz description.

---

### Assignment scope and lead folders

Apply `supabase/migrations/0043_separate_custom_folder_membership.sql` in the
Supabase SQL Editor before running this application version. The migration
preserves folder contents and moves existing owned-folder assignments into
separate staff lists. Legacy schedules targeting unowned custom folders pause
for destination review. The application service key cannot apply SQL migrations.
`supabase/tests/custom_folder_membership.sql` is a destructive-schema fixture for
an **empty disposable local database only**, never the live Supabase database.


The Custom Folders directory shows only folders created through **New Folder**.
Only super admins can delete folders or lists. Custom folder cards have a
**Delete folder** button with confirmation; deletion keeps the customer leads
in All Leads and preserves their staff assignments. Deleting an assignment list
unassigns its leads but preserves their custom folder membership.
Allocation and recycle lists remain in Lead Lists / My Leads. Folder identities
are persisted as `lead_custom_folder:<list-id>` keys in `app_settings`, separate
from list names and owners. Legacy folder-creation audit records are recovered
and persisted on first directory load so audit retention cannot remove cards.

Only `super_admin` has global lead and employee visibility. Regular `admin`
accounts have all six permissions but read and edit their assigned records;
`staff` additionally require explicitly granted permissions. Global allocation,
recycling, schedules, and employee reassignment are super-admin operations.

After migration `0043`, a lead can belong to one custom folder (`lead_folder_items`)
and one staff assignment list (`lead_list_items`, exclusive constraint from `0042`).
Normal allocation includes all unassigned statuses by default and preserves each
lead’s current status. An explicit status selection narrows both the preview and
the allocated batch; existing schedules retain their saved filters.
Allocating or recycling a lead preserves its custom folder. Staff visibility comes
only from the assignment list's `assigned_admin_user_id`. Folder moves use one atomic upsert;
scoped users can move only their own leads between their own folders. New folders
created by scoped users are automatically assigned to them. Employee records and
login accounts are separate entities.

Search matches names, formatted or partial phones, car numbers, model, area, and
address. Encrypted fields are decrypted server-side within the caller's filtered
scope before matching. The root directory has separate lead search and folder
filter inputs; staff can search their assignments on My Leads or within a list.

Payments use the same lead scope for page, save, and export; edits require
`payments.manage`. Daily report calls represent logged disposition changes, not
verified telephone calls. Unanswered and custom pending statuses remain pending
consistently across reports, list progress, and queue replenishment.

Scheduled jobs use `GET /api/cron/lead-allocations` with a required
`Authorization: Bearer <CRON_SECRET>` header. Configure a scheduler to call it;
the repository does not install an external cron schedule. Automated list creation
does not require a browser session. Migration `0042` must be applied for atomic
folder moves.

## 8. Application-layer encryption

Selected sensitive columns are encrypted with AES-256-GCM keyed by
`APP_ENCRYPTION_KEY`. Phone numbers also have an HMAC-SHA256 sibling
(`phone_hash`) so exact-match search keeps working.

| Table | Encrypted columns |
| --- | --- |
| `leads` | `phone`, `car_number`, `address`, `map_link`, `gate_access_notes`, `notes` |
| `employees` | `phone`, `aadhaar_number`, `notes` |
| `payments` | `notes` |
| `audit_logs` | `metadata` (entire JSONB blob) |

- Wire format: `enc:v1:` + base64(`IV(12B) | tag(16B) | ciphertext`).
- Encryption happens at the lib boundary — `insertLead`, `updateLead`,
  `insertEmployee`, etc. wrap inputs with `sealFields(...)` and
  outputs with `unsealFields(...)`. **Callers always see plaintext.**
- The wire-format prefix makes the seal/unseal pair idempotent, so the
  one-shot backfill (`POST /api/admin/encrypt-backfill`) can re-run safely.
- Searching by encrypted fields doesn't work (you can't `ILIKE` on
  ciphertext). For phone we keep `phone_hash`; for partial substring search
  (e.g. address), we deliberately store `leads.area` plaintext instead and
  auto-derive it from pincode via `pincode_areas` seeded with common
  Chennai pincodes.

See `SECURITY.md` § *Application-layer field encryption* for full details.

---

## 9. Audit logging

- Every admin write goes through `logAudit(action, opts)` in
  `src/lib/audit.ts`.
- Where the action edits an existing row, the caller passes `before` /
  `after` snapshots — `logAudit` computes the field-level diff and stores
  it in `metadata` (sealed).
- The logs page (`/admin/logs`) renders the diff as a `Field | From | To`
  table with humanised labels (`humaniseField()` in `audit.ts`).
- Date-range CSV export at `GET /api/admin/audit-export`. Retention is 6
  months, opportunistically pruned on writes and on every logs-page view.

Entities covered with full before/after diffs today: lead update, employee
update, job update, car update, tier update, discount save, payment save,
booking config save, site settings save, message templates save, access
permission changes, radius bump, force-logout, force-logout-all. Create /
delete / status-toggle actions log a summary only (no "before" exists).

---

## 10. Booking wizard

`src/components/booking/BookingWizard.tsx` orchestrates 5 steps:

1. **Contact** (`StepContact.tsx`) — Name, phone, service category +
   sub-option. Categories and sub-options come from the dynamic catalog
   (with hardcoded legacy presets for icon/colour/`defaultPkg`).
2. **Vehicle & Schedule** (`StepVehicle.tsx`) — Vehicle type, parking, GPS
   serviceability check (against the admin-controlled radius per service).
3. **Location** (`StepVehicle.tsx` covers all of step 3, despite the name —
   the file is consolidated for now).
4. **Package** (`StepPackage.tsx`) — Shows per-car prices via tier lookup;
   discount strike + corner ribbon respect the badge toggle.
5. **Confirm** (`StepConfirm.tsx`) — Final total, submits to `/api/booking`.

Every step's title, subtitle, message strings, custom fields, built-in
field toggles, and certain display flags (e.g. "show strike + % OFF") are
admin-editable in `/admin/booking` and stored as
`app_settings.booking`.

The booking POST handler (`src/app/api/booking/route.ts`):
- Validates phone, required custom fields.
- Server-side radius check on every submit (re-derives from the
  admin-configured radius, not trust client).
- Computes price via `carPriceFor` (legacy options) or
  `carPriceForCatalog` (admin-created options).
- Calls `insertLead` — which seals the encrypted columns, computes
  `phone_hash`, auto-derives `area` from pincode.

---

## 11. Local development

### Prerequisites

- Node 18+ (Next 16 needs it).
- A Supabase project (free tier works).
- `openssl` for generating secrets.

### One-time setup

```bash
git clone <repo>
cd klicseo-app
npm install
cp .env.example .env.local   # or create from scratch — see env-vars below
```

Add to `.env.local`:

```env
# From Supabase dashboard → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# 64-char hex (openssl rand -hex 32)
ADMIN_COOKIE_SECRET=<random-64-hex>
APP_ENCRYPTION_KEY=<random-64-hex>

# Your owner email
SUPER_ADMIN_EMAIL=jv@blackpome.com

# Local site URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### Apply migrations

```bash
supabase db push          # if you have the Supabase CLI linked
# or paste each supabase/migrations/*.sql into the SQL editor
```

### Run

```bash
npm run dev    # http://localhost:3000  (Turbopack)
npm run lint   # eslint
npx tsc --noEmit   # typecheck only
```

### Create your first admin user

`SUPER_ADMIN_EMAIL` is auto-trusted with full access. Log in at
`/admin/login` with that email + the password you set in Supabase Auth.

For staff / additional admins, go to `/admin/access` and click "Invite
user". They get an email; on first click they set their password and land
on `/admin`.

### Backfill encryption + area (first deploy only)

After deploy with a populated DB:

```js
// In the browser console of an admin page, signed in as super-admin:
fetch("/api/admin/encrypt-backfill", { method: "POST" })
  .then(r => r.json()).then(console.log)
```

Idempotent. Encrypts every chosen field in every existing row, computes
phone hashes, fills `leads.area` from pincodes.

---

## 12. Deployment

The project is a standard Next.js 16 app. **Vercel** is what we've tested
against; any platform that supports Node + Next 16 works.

Required environment variables (see § 11 + `SECURITY.md`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`  *(server-only)*
- `ADMIN_COOKIE_SECRET`  *(server-only, 32+ chars)*
- `APP_ENCRYPTION_KEY`  *(server-only, 32 bytes hex)*
- `SUPER_ADMIN_EMAIL`
- `NEXT_PUBLIC_SITE_URL`

Supabase-side configuration:
- **Authentication → URL configuration → Site URL**: set to your prod URL.
  This drives the link in invite/reset emails.
- **Authentication → SMTP settings**: use your own SMTP (Gmail's
  `smtp.gmail.com` works, but use an app-specific password).
- **Storage**: create buckets `employee-docs` and `site-media` (private and
  public respectively). RLS policies are not strictly required because
  writes are service-role only.

---

## 13. Patterns to follow (and gotchas to avoid)

### Server actions, not API routes, for admin mutations

`"use server"` files in admin route folders host the mutation actions. They
call `requirePermission(perm)` first, then the lib, then `logAudit(...)`,
then `revalidatePath(...)`. The exception is `/api/*` for things that need
a non-form-based interface (`/api/booking`, `/api/admin/whoami`, exports).

### Don't `await supabase().from(...).update(plaintext)` directly

Always go through the lib boundary (`updateLead`, `updateEmployee`,
`upsertPayment`, …) so encryption is applied. A direct `update` from a
server action bypasses the seal and silently corrupts the encrypted-column
invariant.

### `force-dynamic` admin pages

Admin pages that mutate frequently should set:

```ts
export const dynamic = "force-dynamic";
```

Otherwise Next caches the rendered HTML and the post-action UI shows stale
data. Already done for `/admin/payments`, `/admin/logs`, `/admin/services`,
`/admin/access`, `/admin/cars`. Mirror this for any new admin page.

### Hydration mismatches

If a client component generates IDs with `Math.random()` or timestamps in
its initial render, server and client will disagree and React will throw a
hydration warning. Either use deterministic seed IDs for the SSR pass (see
`BulkCarsSheet.tsx`'s `seed-0`/`seed-1` pattern) or move the generation to
an effect that runs only on the client.

### Nested forms

The booking admin (`BookingForm`) is a single big `<form>`. Anything
embedded inside it (Services editor, Field builder) **must not** use nested
`<form>` tags. Use `useTransition` + server-action imperative dispatch
instead. See `ServicesEditor.tsx` for the pattern.

### Calendar picker icons

Date inputs in dark theme need the gold-tinted icon override in
`globals.css`. Already global; new `<input type="date|month|time">` picks
it up automatically.

### Migrations are append-only

Never edit a migration that's already been applied on a real database.
Write a new one that does the change. Keep numbers sequential.

### `pricing.ts` is partly hard-coded

The legacy enum (`ServiceOptionId`, `OPTIONS_BY_CATEGORY`, etc.) is still
used by the booking wizard for the well-known six options. Admin-created
new options bypass this path via `carPriceForCatalog`. **Don't delete the
hard-coded enum yet** — too many call sites depend on it.

### `withTierPrices` is the join you'll forget

When fetching `cars` for read paths, always pipe through
`withTierPrices(...)` (in `src/lib/cars.ts`) — that's the helper that
joins `price_tier_amounts` and projects the prices back onto the row.
Raw `cars` selects return rows without prices.

---

## 14. Common admin tasks the code already supports

| Task | Where |
| --- | --- |
| Add a lead manually | `/admin/new` |
| Edit / delete a lead | `/admin/[id]` → Edit button |
| Bulk-add cars to a tier | `/admin/cars/tier/[id]` → Bulk add |
| Rename a service category | `/admin/booking` → Step 1 → Services editor |
| Add a new sub-category | Same page, "+ New sub-category" |
| Toggle discount per line | `/admin/discount` (rows come from catalog) |
| Edit WhatsApp message templates | `/admin/payments` → templates editor at the top |
| Adjust per-service radius | `/admin/booking` → Step 3 |
| Force sign-out a user | `/admin/access` → 🚪 icon |
| Block a user (suspend without delete) | `/admin/access` → 🚫 icon (super-admin only) |
| Demote admin → staff | `/admin/access` → ⬇ icon (super-admin only) |
| Sign out everyone at once | `/admin/access` → "Sign out all" |
| Date-range audit log export | `/admin/logs` → date range → Export CSV |
| Monthly payments CSV | `/admin/payments` → Download |
| Full DB ZIP export | `/admin/settings` → Export data |

---

## 15. Notable design decisions worth knowing

These are the "why" answers an AI agent or new developer will need.

1. **Per-line discount badge toggle is the master switch for discount.**
   When admin turns off a line's badge, the discount is treated as 0 for
   that line — both display and charged price. Single source: the
   `effectiveDiscounts` helper in `pricing.ts`.
2. **Phone numbers are encrypted but exact-match searchable** via the
   `phone_hash` HMAC column. Partial phone search no longer works.
3. **`leads.area` is plaintext on purpose** so admins can filter by
   neighbourhood without the full address (gate codes, flat numbers)
   leaking via index columns.
4. **Cars don't store prices** — only `tier_id`. The legacy 9 columns were
   dropped in migration 0020.
5. **Tier prices don't live on `price_tiers` either** — only metadata
   (name, sort_order). The amounts are in `price_tier_amounts` keyed by
   `line_id`. This made it possible to support admin-created lines.
6. **Audit log metadata is sealed end-to-end** — even before/after
   snapshots of decrypted PII don't leak via the audit table.
7. **Service-area radius enforcement happens server-side** on the booking
   POST, not just on the client. A stale client tab can't bypass it.
8. **All four user kill-switches keep distinct semantics.** Force-logout
   doesn't change permissions, Block sets `status='revoked'`, Demote
   changes role, Remove deletes the row + Supabase user. Confused
   maintainers tend to merge these — don't.

---

## 16. Useful scripts

```bash
npm run dev        # Local dev with Turbopack
npm run build      # Production build
npm run start      # Run the production build
npm run lint       # ESLint
npx tsc --noEmit   # Type check only
```

Run `npm test -- --run` for the Vitest unit and component suite. It includes
admin/staff scope, encrypted-field search, folder moves, imports, reports, and
allocation regressions. Run `npx tsc --noEmit` and `npm run build` before release.

---

## 17. Reporting / contact

Owner: klicseo@gmail.com.
For security issues use the subject `SECURITY` (see `SECURITY.md` for the
disclosure policy). Do **not** open public issues for security bugs.

---

## 18. Further reading inside this repo

- [`SECURITY.md`](./SECURITY.md) — threat model, secret management, encryption design.
- [`AGENTS.md`](./AGENTS.md) — instructions for AI agents (Next.js 16 reminder).
- [`CLAUDE.md`](./CLAUDE.md) — loads AGENTS.md for the Claude Code agent.
- [`supabase/ADMIN_AUTH_SETUP.md`](./supabase/ADMIN_AUTH_SETUP.md) — Supabase Auth + SMTP setup walkthrough.
- [`supabase/email-templates/`](./supabase/email-templates/) — branded invite/recovery email HTML.

### Global recycling during allocation

The allocation modal offers **Include already-assigned leads** for immediate,
scheduled, daily, and auto-refill allocations. It is off by default. When enabled,
unassigned leads are used first; other matching leads transfer from their old list.
Statuses (including Booked and custom statuses) and custom folders are preserved.
Leads already with the target team are excluded. Each recurring rule delivers a
lead only once, tracked in `lead_allocation_deliveries`.

Apply `supabase/migrations/0044_global_allocation_recycling.sql` before deploying
this feature. The service-role-only RPC commits lists, membership changes, history,
and delivery tracking together. It serializes list membership writes for the
transaction and skips candidates whose status or assignment changed after selection.
Old schedules without `include_assigned` continue using unassigned leads only.

Database integration checks can be run against an **empty disposable PostgreSQL
database** using `psql -v ON_ERROR_STOP=1 -f supabase/tests/global-allocation-recycling.sql`.
This script creates minimal fixture tables and must never run against application data.
