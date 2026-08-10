# Sky Concierge 🌌

> Never miss a light in the sky again.

Sky Concierge computes **what's worth looking at tonight** — ISS passes, aurora
activity and meteor showers — for your exact coordinates, and (soon) emails you
before something good happens.

A notification-first astronomy web app: instead of another heavy planetarium
map, it's a lightweight "sky concierge" that tells you *when to look up*.

## Features (v0.1)

- **Tonight's Brief** — live dashboard computed for any lat/lon:
  - **ISS passes**: next passes with rise/set times, max elevation and
    duration, predicted with SGP4 propagation (satellite.js) from live
    CelesTrak TLEs.
  - **Aurora**: peak predicted Kp for the next 12 hours from NOAA SWPC, with a
    level badge and viewing-latitude hint.
  - **Meteor showers**: countdown to every major shower peak.
- **Location-aware** — "Use my location" button, or pass `?lat=&lon=` in the URL.
- **Alert subscriptions** — pick events + email, stored in SQLite via Prisma.
- **Alert engine** — `pnpm check:alerts` evaluates every subscription and
  dispatches due alerts (console sender for now, pluggable for email/push).
- Graceful degradation — each data source fails independently.

## Tech stack

- **Next.js 16** (App Router) + **TypeScript** (strict) + **Tailwind CSS v4**
- **Prisma ORM** + SQLite (swap to Postgres for production)
- **satellite.js** (SGP4 propagation), **CelesTrak** (TLEs), **NOAA SWPC**
  (Kp forecast), **Vitest** (unit tests)

## Quick start

Requirements: Node.js 24+, pnpm 11+.

```bash
pnpm install          # installs deps + runs prisma generate
pnpm db:migrate       # applies the SQLite migration (prisma/dev.db)
pnpm dev              # http://localhost:3000 (3001 if 3000 is busy)
```

Open the app, hit **Use my location**, and scroll to *Tonight's Brief*.

## Scripts

| Script              | Description                                  |
| ------------------- | -------------------------------------------- |
| `pnpm dev`          | Dev server                                   |
| `pnpm build`        | Production build                             |
| `pnpm typecheck`    | TypeScript check (no emit)                   |
| `pnpm lint`         | ESLint                                       |
| `pnpm test`         | Vitest (pass prediction, aurora, showers)    |
| `pnpm check:alerts` | Run the alert engine once                    |
| `pnpm db:migrate`   | Apply/create a migration                     |
| `pnpm db:studio`    | Prisma Studio                                |

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
  lib/            Prisma client, api envelope, validation helpers
  config/         App constants
prisma/           Schema + SQLite migrations
scripts/          check-alerts CLI
```

Key design choices:

- **Deterministic & testable**: pass prediction, Kp parsing and the shower
  calendar take an injectable clock and are unit-tested with a fixed TLE.
- **Consistent API envelope**: `{ success, data }` / `{ success, error }` on
  every route.
- **No secrets in the repo**: `.env` / `.env.local` are gitignored. (The
  AstronomyAPI credentials from the earlier AstroHunt project were burned —
  this project keeps them out entirely.)

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
- [ ] Production Postgres swap + deployment (Vercel)
