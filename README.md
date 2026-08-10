# Sky Concierge 🌌

> Never miss a light in the sky again.

Sky Concierge computes **what's worth looking at tonight** — ISS passes, aurora
activity, meteor showers and the best dark-sky window — for your exact
coordinates, and emails you before something good happens.

A notification-first astronomy web app: instead of another heavy planetarium
map, it's a lightweight "sky concierge" that tells you *when to look up*.

## Features (v0.1)

- **Tonight's Brief** — live dashboard computed for any lat/lon:
  - **ISS passes**: next passes with rise/set times, max elevation, azimuth
    and duration, predicted with SGP4 propagation (satellite.js) from live
    CelesTrak TLEs.
  - **Aurora**: peak predicted Kp for the next 12 hours from NOAA SWPC, with a
    level badge and viewing-latitude hint.
  - **Meteor showers**: countdown to every major shower peak.
  - **Moon & best viewing window**: phase, illumination, rise/set, and the
    longest moon-free window tonight (SunCalc) — "moonless night ✨" when
    the skies stay dark.
- **Location-aware** — "Use my location" button, or pass `?lat=&lon=` in the URL.
- **Alert subscriptions** — pick events + email, stored in SQLite.
- **Alert engine** — `pnpm check:alerts` evaluates every subscription and
  emails due alerts via **Resend** (falls back to console without an API key).
  Dedup is atomic via a SQL unique index — overlapping runs never double-send.
- Graceful degradation — each data source fails independently.

## Tech stack

- **Next.js 16** (App Router) + **TypeScript** (strict) + **Tailwind CSS v4**
- **SQLite via `node:sqlite`** — zero database dependencies, no migrations CLI,
  no env vars. The schema is idempotent (`CREATE TABLE IF NOT EXISTS`).
- **satellite.js** (SGP4 propagation), **SunCalc** (moon/sun), **CelesTrak**
  (TLEs), **NOAA SWPC** (Kp forecast), **Resend** (email), **Vitest** (tests)

## Quick start

Requirements: Node.js 24+, pnpm 11+.

```bash
pnpm install
pnpm dev        # http://localhost:3000 (3001 if 3000 is busy)
```

No database setup step — the SQLite file (`data/sky.db`) is created
automatically on first use. Open the app, hit **Use my location**, and scroll
to *Tonight's Brief*.

### Real email alerts

```bash
cp .env.example .env.local
# set RESEND_API_KEY (https://resend.com/api-keys) — from "Sky Concierge
# <onboarding@resend.dev>" works for testing
pnpm check:alerts     # emails due alerts; console fallback without a key
```

## Scripts

| Script              | Description                                  |
| ------------------- | -------------------------------------------- |
| `pnpm dev`          | Dev server                                   |
| `pnpm build`        | Production build                             |
| `pnpm typecheck`    | TypeScript check (no emit)                   |
| `pnpm lint`         | ESLint                                       |
| `pnpm test`         | Vitest (sky math, moon, alert engine, db)    |
| `pnpm check:alerts` | Run the alert engine once                    |

## Architecture

```
src/
  app/            Pages and API routes
    api/sky/brief       GET  tonight's brief for ?lat=&lon=
    api/subscriptions   POST create an alert subscription
  components/     UI (starfield, brief cards, subscribe form, locate button)
  services/
    sky/          Pure sky math & data: TLE fetch, pass prediction, aurora,
                  meteor shower calendar, moon & viewing window, brief
    alerts/       Alert engine: due-alert logic + pluggable sender
                  (Resend email, console fallback)
  lib/            SQLite data layer (node:sqlite), api envelope, helpers
  config/         App constants
data/             Local SQLite database (gitignored, auto-created)
scripts/          check-alerts CLI
```

Key design choices:

- **Zero-friction setup**: no ORM, no migrations, no required env vars. The
  entire persistence layer is `src/lib/db.ts` — two tables, atomic dedup via
  `ON CONFLICT DO NOTHING`.
- **Deterministic & testable**: pass prediction, Kp parsing, the shower
  calendar and moon math take an injectable clock and are unit-tested; the
  alert engine's decision logic is a pure function with integration tests
  for dispatch + dedup against an in-memory database.
- **Consistent API envelope**: `{ success, data }` / `{ success, error }` on
  every route.
- **No secrets in the repo**: `.env*` + `data/` are gitignored.

## Data sources

| Source      | Used for                        | Endpoint                     |
| ----------- | ------------------------------- | ---------------------------- |
| CelesTrak   | Satellite TLEs                  | `gp.php?CATNR=25544`         |
| NOAA SWPC   | Planetary K-index forecast      | `noaa-planetary-k-index-forecast.json` |
| SunCalc     | Moon phase, rise/set, dark windows | (local computation)       |
| Resend      | Alert emails                    | `api.resend.com/emails`      |

## Roadmap

- [x] Real email sender (Resend) + cron-ready `check:alerts`
- [x] Moon phase + best-viewing-window card
- [ ] Push notifications (PWA)
- [ ] Satellite list beyond the ISS (via `ISS_NORAD_IDS` env)
- [ ] Account-less digest ("weekly sky highlights for your location")
- [ ] Deployment (Vercel)
