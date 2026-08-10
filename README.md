# Sky Concierge 🌌

> Never miss a light in the sky again.

Sky Concierge computes **what's worth looking at tonight** — ISS passes, aurora
activity and meteor showers — for your exact coordinates, and (soon) emails you
before something good happens.

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
- **Location-aware** — "Use my location" button, or pass `?lat=&lon=` in the URL.
- **Alert subscriptions** — pick events + email, stored in SQLite.
- **Alert engine** — `pnpm check:alerts` evaluates every subscription and
  dispatches due alerts (console sender for now, pluggable for email/push).
  Dedup is atomic via a SQL unique index — overlapping runs never double-send.
- Graceful degradation — each data source fails independently.

## Tech stack

- **Next.js 16** (App Router) + **TypeScript** (strict) + **Tailwind CSS v4**
- **SQLite via `node:sqlite`** — zero database dependencies, no migrations CLI,
  no env vars. The schema is idempotent (`CREATE TABLE IF NOT EXISTS`).
- **satellite.js** (SGP4 propagation), **CelesTrak** (TLEs), **NOAA SWPC**
  (Kp forecast), **Vitest** (unit tests)

## Quick start

Requirements: Node.js 24+, pnpm 11+.

```bash
pnpm install
pnpm dev        # http://localhost:3000 (3001 if 3000 is busy)
```

No database setup step — the SQLite file (`data/sky.db`) is created
automatically on first use. Open the app, hit **Use my location**, and scroll
to *Tonight's Brief*.

## Scripts

| Script              | Description                                  |
| ------------------- | -------------------------------------------- |
| `pnpm dev`          | Dev server                                   |
| `pnpm build`        | Production build                             |
| `pnpm typecheck`    | TypeScript check (no emit)                   |
| `pnpm lint`         | ESLint                                       |
| `pnpm test`         | Vitest (pass prediction, aurora, showers, db)|
| `pnpm check:alerts` | Run the alert engine once                    |

## Architecture

```
src/
  app/            Pages and API routes
    api/sky/brief       GET  tonight's brief for ?lat=&lon=
    api/subscriptions   POST create an alert subscription
  components/     UI (starfield, brief cards, subscribe form, locate button)
  services/
    sky/          Pure sky math & data: TLE fetch, pass prediction,
                  aurora (Kp), meteor shower calendar, brief aggregator
    alerts/       Alert engine: due-alert detection + pluggable sender
  lib/            SQLite data layer (node:sqlite), api envelope, helpers
  config/         App constants
data/             Local SQLite database (gitignored, auto-created)
scripts/          check-alerts CLI
```

Key design choices:

- **Zero-friction setup**: no ORM, no migrations, no env vars required. The
  entire persistence layer is `src/lib/db.ts` — two tables, atomic dedup via
  `ON CONFLICT DO NOTHING`.
- **Deterministic & testable**: pass prediction, Kp parsing and the shower
  calendar take an injectable clock and are unit-tested with a fixed TLE; the
  data layer is tested against an in-memory database.
- **Consistent API envelope**: `{ success, data }` / `{ success, error }` on
  every route.
- **No secrets in the repo**: no API keys are ever needed server-side, and
  `.env*` + `data/` are gitignored.

## Data sources

| Source      | Used for                        | Endpoint                     |
| ----------- | ------------------------------- | ---------------------------- |
| CelesTrak   | Satellite TLEs                  | `gp.php?CATNR=25544`         |
| NOAA SWPC   | Planetary K-index forecast      | `noaa-planetary-k-index-forecast.json` |

## Roadmap

- [ ] Real email sender (Resend / SES) wired into the alert engine + cron
- [ ] Push notifications (PWA)
- [ ] Satellite list beyond the ISS (via `ISS_NORAD_IDS` env)
- [ ] Moon phase + light-pollution-aware "best viewing window"
- [ ] Account-less digest ("weekly sky highlights for your location")
- [ ] Deployment (Vercel)
