# Sky Concierge 🌌

> Never miss a light in the sky again.

Sky Concierge computes **what's worth looking at tonight** — ISS passes, aurora
activity, meteor showers and the best dark-sky window — for your exact
coordinates, and emails you before something good happens.

A notification-first astronomy web app: instead of another heavy planetarium
map, it's a lightweight "sky concierge" that tells you _when to look up_.

## Features

- **Tonight's Brief** — live dashboard computed for any lat/lon:
  - **Satellite passes** with a **tracker picker** (ISS, Tiangong, Hubble,
    NOAA 19, Terra, Aqua, or any custom NORAD id — up to 4 at once): next
    passes with rise/set times, max elevation, azimuth and duration,
    predicted with SGP4 propagation (satellite.js) from live CelesTrak TLEs.
    The selection lives in the URL (`?sat=25544,48274`) and the brief
    recomputes for it; alerts use the server-configured set (`ISS_NORAD_IDS`).
  - **Aurora**: peak predicted Kp for the next 12 hours from NOAA SWPC, with a
    level badge and viewing-latitude hint.
  - **Meteor showers**: countdown to every major shower peak.
  - **Moon & best viewing window**: phase, illumination, rise/set, and the
    longest moon-free window tonight (SunCalc) — "moonless night ✨" when the
    skies stay dark.
  - **Tonight at a glance** — a night timeline: sunset → sunrise with the
    moon's up/down periods, pass markers, moonrise/set ticks and a "now"
    cursor.
  - **Live sky radar** — a custom canvas map (no map tiles) centered on your
    location, plotting each tracked satellite's live position and ground
    track (past 30 min dim, next 90 min bright) with range rings and the
    horizon circle. TLEs come from the same cache as the brief and are
    propagated in the browser, so the map animates in real time.
  - All times render in **the location's timezone** (derived from lat/lon),
    not the server's.
- **Location-aware** — "Use my location" button, `?lat=&lon=` in the URL, and
  your last location is remembered between visits.
- **Alert subscriptions** — pick events + email, stored in SQLite:
  - **Double opt-in**: with a real email sender configured, a confirmation
    email is sent first; unconfirmed addresses never receive alerts.
  - **One-click unsubscribe** link in every email.
  - **Push notifications** (PWA): browser alerts for the same events — no
    email needed. Requires VAPID keys (see below).
  - **Weekly digest** — `pnpm check:alerts --digest` emails a "sky highlights
    of the week" summary, at most once per ISO week.
- **Alert engine** — `pnpm check:alerts` evaluates every subscription and
  emails due alerts via **Resend** (falls back to console without an API key).
  Dedup is atomic via a SQL unique index — overlapping runs never double-send.
- **Hardened by default** — upstream TLE/Kp data is TTL-cached (CelesTrak and
  NOAA aren't hit on every page load), the two live fetches run in parallel,
  API routes are rate-limited, and security headers (incl. CSP) are applied
  to every response.
- Graceful degradation — each data source fails independently.

## Tech stack

- **Next.js 16** (App Router) + **TypeScript** (strict) + **Tailwind CSS v4**
- **SQLite via `node:sqlite`** — zero database dependencies, no migrations CLI,
  no env vars. The schema is idempotent (`CREATE TABLE IF NOT EXISTS` plus
  column additions for pre-existing databases).
- **satellite.js** (SGP4 propagation), **SunCalc** (moon/sun), **tz-lookup**
  (location timezones), **web-push** (Web Push / VAPID), **CelesTrak** (TLEs),
  **NOAA SWPC** (Kp forecast), **Resend** (email), **Vitest** (tests)

## Quick start

Requirements: Node.js 24+, pnpm 11+.

```bash
pnpm install
pnpm dev        # http://localhost:3000 (3001 if 3000 is busy)
```

No database setup step — the SQLite file (`data/sky.db`) is created
automatically on first use. Open the app, hit **Use my location**, and scroll
to _Tonight's Brief_.

### Real email alerts

```bash
cp .env.example .env.local
# set RESEND_API_KEY (https://resend.com/api-keys) — from "Sky Concierge
# <onboarding@resend.dev>" works for testing
pnpm check:alerts     # emails due alerts; console fallback without a key
```

When `RESEND_API_KEY` is set, new signups must confirm their email first (the
confirmation link is emailed to them). Without a key, signups are active
immediately and alerts print to the console.

### Push notifications

```bash
pnpm exec web-push generate-vapid-keys
# copy VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY into .env.local, set VAPID_SUBJECT
```

With keys configured, the "Push notifications" toggle appears on the site and
the alert engine dispatches matching browser notifications alongside emails.
Without keys, push is silently skipped.

### Weekly digest

```bash
pnpm check:alerts --digest   # weekly highlights email, deduped per ISO week
```

Run the digest on a weekly cron (a Vercel Cron that runs the script once a
week works well).

## Scripts

| Script              | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Dev server                                                          |
| `pnpm build`        | Production build                                                    |
| `pnpm typecheck`    | TypeScript check (no emit)                                          |
| `pnpm lint`         | ESLint                                                              |
| `pnpm test`         | Vitest (sky math, moon, alerts, digest, db, API routes, rate limit) |
| `pnpm check:alerts` | Run the alert engine once (`--digest` for the weekly digest)        |

## Architecture

```
src/
  app/            Pages and API routes
    api/sky/brief           GET  tonight's brief for ?lat=&lon=&norad=
    api/sky/tles            GET  TLEs for the live radar (?norad=)
    api/subscriptions       POST create (double opt-in) / verify / unsubscribe
    api/push-subscriptions  POST/DELETE browser push registrations
    api/push/public-key     GET  VAPID public key for the browser
    verify, unsubscribe     Confirmation / unsubscribe landing pages
    manifest.ts             PWA manifest
  components/     UI (starfield, brief cards, night timeline, live sky radar,
                  subscribe form, push toggle, locate + remembered-location)
  services/
    sky/          Pure sky math & data: TLE fetch (TTL-cached), pass
                  prediction, aurora, meteor shower calendar, moon & viewing
                  window, brief (parallel, cached fetches)
    alerts/       Alert engine: due-alert logic + pluggable sender
                  (Resend email, console fallback), Web Push dispatch,
                  weekly digest
  lib/            SQLite data layer, TTL cache, rate limiter, logger, api
                  envelope, satellite-map math, helpers
  config/         App constants
data/             Local SQLite database (gitignored, auto-created)
public/sw.js      Service worker (push notifications)
scripts/          check-alerts CLI
```

Key design choices:

- **Zero-friction setup**: no ORM, no migrations, no required env vars. The
  entire persistence layer is `src/lib/db.ts` — a few tables, atomic dedup via
  `ON CONFLICT DO NOTHING`, and idempotent column additions so old databases
  upgrade themselves on startup.
- **Deterministic & testable**: pass prediction, Kp parsing, the shower
  calendar and moon math take an injectable clock and are unit-tested; the
  alert engine's decision logic is a pure function with integration tests
  for dispatch + dedup against an in-memory database; API routes have
  handler-level tests for validation, envelopes, opt-in flow and rate limits.
- **Location-correct times**: every rendered/emailed time is formatted in the
  observer's IANA timezone (`tz-lookup` from lat/lon) — a stargazer in Tokyo
  sees Tokyo time.
- **Consistent API envelope**: `{ success, data }` / `{ success, error }` on
  every route.
- **No secrets in the repo**: `.env*` + `data/` are gitignored.

## Data sources

| Source    | Used for                                | Endpoint                               |
| --------- | --------------------------------------- | -------------------------------------- |
| CelesTrak | Satellite TLEs (TTL-cached)             | `gp.php?CATNR=25544`                   |
| NOAA SWPC | Planetary K-index forecast (TTL-cached) | `noaa-planetary-k-index-forecast.json` |
| SunCalc   | Moon phase, rise/set, dark windows      | (local computation)                    |
| Resend    | Alert emails                            | `api.resend.com/emails`                |

## Roadmap

- [x] Real email sender (Resend) + cron-ready `check:alerts`
- [x] Moon phase + best-viewing-window card
- [x] Location timezone rendering (no more UTC-itis)
- [x] Upstream caching + parallel fetches
- [x] Double opt-in + one-click unsubscribe
- [x] Push notifications (PWA, VAPID)
- [x] Weekly digest email
- [x] Rate limiting + security headers
- [x] Satellite picker UI (multiple NORAD IDs)
- [x] Live sky radar (custom canvas ground-track map)
- [ ] Deployment (Vercel) + cron for the alert engine
