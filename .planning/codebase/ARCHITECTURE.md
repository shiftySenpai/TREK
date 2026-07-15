<!-- refreshed: 2026-07-15 -->
# Architecture

**Analysis Date:** 2026-07-15

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                  React SPA (Client)                         │
│  Pages + Components + Zustand Stores + Offline IndexedDB    │
│              `client/src/`                                   │
└────────┬─────────────────────────────┬───────────────────────┘
         │ HTTP (Axios)                │ WebSocket (/ws)
         │ + Idempotency Keys          │ Real-time sync
         ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│              NestJS API Server                               │
│  Controllers + Services + Middleware + Global Filters       │
│         `server/src/nest/`                                  │
├──────────────────────────────────────────────────────────────┤
│  Shared Contracts (@trek/shared)                             │
│  Zod schemas for request/response validation                │
│         `shared/src/[domain]/`                              │
├──────────────────────────────────────────────────────────────┤
│  SQLite Database (better-sqlite3)                            │
│  `server/src/db/` (schema, migrations, raw SQL queries)     │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| React Router | Client-side routing and navigation | `client/src/App.tsx` |
| NestJS AppModule | Server-side module composition and DI | `server/src/nest/app.module.ts` |
| TripsController | Trip CRUD endpoints | `server/src/nest/trips/trips.controller.ts` |
| TripsService | Trip business logic and queries | `server/src/nest/trips/trips.service.ts` |
| Zustand Stores | Client state management (auth, trips, settings, etc.) | `client/src/store/*.ts` |
| AuthStore | Authentication state, session, user profile | `client/src/store/authStore.ts` |
| TripStore | Current trip data and mutations | `client/src/store/tripStore.ts` |
| Axios API Client | HTTP requests with error handling and idempotency | `client/src/api/client.ts` |
| WebSocket Handler | Real-time broadcasts, room-based trip subscriptions | `server/src/websocket.ts` |
| Database Module | SQLite connection, migrations, initialization | `server/src/db/database.ts` |
| Middleware (Auth, MFA) | Request guards, authentication, MFA enforcement | `server/src/middleware/` |
| IdempotencyInterceptor | Replay protection for mutations | `server/src/nest/common/idempotency.interceptor.ts` |
| TripSyncManager | Client-side background sync, retry logic | `client/src/sync/tripSyncManager.ts` |
| OfflineDb (IndexedDB) | Client-side cache for trips, places, assignments | `client/src/db/offlineDb.ts` |

## Pattern Overview

**Overall:** Strangler migration pattern with full NestJS + React incremental modernization.

**Key Characteristics:**
- **Three-layer monorepo:** shared contracts (Zod), NestJS backend, React SPA
- **Shared-first development:** API contracts in `@trek/shared` used by both server and client
- **Offline-first PWA:** IndexedDB + WebSocket-driven sync for collaborative editing
- **Mode-based composition:** Strangler toggles (via env vars) control which routes run on NestJS vs. legacy code
- **Incremental migration:** One domain at a time migrated to NestJS + `@trek/shared` schemas

## Layers

**Client Layer (React + Zustand):**
- Purpose: Render UI, manage session state, queue mutations, display real-time updates
- Location: `client/src/`
- Contains: Pages, components, stores, API client, custom hooks
- Depends on: HTTP API, WebSocket, browser IndexedDB
- Used by: User browser via React Router

**API Contract Layer (Zod schemas):**
- Purpose: Single source of truth for API contracts, validation, type inference
- Location: `shared/src/[domain]/`
- Contains: `*.schema.ts` files (request/response DTO schemas)
- Depends on: Zod library
- Used by: Server (validation) and client (type inference via `parseInDev`)

**Server Layer (NestJS):**
- Purpose: Handle API requests, apply business logic, persist data, broadcast changes
- Location: `server/src/nest/`
- Contains: Controllers (handlers), services (logic), modules (DI containers), guards (auth)
- Depends on: SQLite database, Zod schemas from `@trek/shared`, services
- Used by: HTTP clients, WebSocket connections

**Database Layer (SQLite):**
- Purpose: Persistent storage for trips, places, users, assignments, etc.
- Location: `server/src/db/`
- Contains: Schema definitions, migrations, raw parameterized SQL queries
- Depends on: better-sqlite3 library, file system
- Used by: Services via `db` object with prepared statements

## Data Flow

### Primary Request Path (CRUD via HTTP)

1. **Client action** → Mutation queued in `client/src/sync/mutationQueue.ts`
2. **Idempotency key sent** → Axios request includes `X-Idempotency-Key` header
3. **Server validation** → `@trek/shared` Zod schema validated by NestJS controller
4. **Service layer** → Business logic in `TripsService`, `PlacesService`, etc.
5. **Database mutation** → Raw SQL prepared statement in `server/src/db/database.ts`
6. **WebSocket broadcast** → Event sent to trip room via `broadcast(tripId, eventType, payload)`
7. **Client sync** → WebSocket listener updates Zustand store, re-renders UI
8. **Offline fallback** → If offline, mutation queued; synced when online via `tripSyncManager.syncAll()`

### Real-Time Sync Path (WebSocket)

1. **Client connects** → POST `/api/auth/ephemeral-token` returns ephemeral token
2. **WebSocket handshake** → Token auth at `ws://host/ws?token=...`
3. **Room join** → `{ type: 'join', tripId: 123 }`
4. **Broadcast from service** → Service calls `broadcast(tripId, 'assignment:updated', data)`
5. **Server sends to room** → All connected sockets in trip 123 get the event (except sender if excluded)
6. **Client listener fires** → WebSocket event listeners in `client/src/sync/syncTriggers.ts` update store
7. **UI re-renders** → React detects store change, component re-renders with new data

### Offline Path

1. **Connectivity probe detects offline** → `client/src/sync/connectivity.ts`
2. **Mutation queued** → `mutationQueue.ts` holds requests until online
3. **IndexedDB populated** → Trip data cached via `offlineDb.ts`
4. **UI shows offline indicator** → `OfflineBanner.tsx` displays connectivity status
5. **Reconnect detected** → Connectivity probe fires, `tripSyncManager.syncAll()` retries all queued mutations
6. **Server re-validates** → Idempotency key prevents double-apply if retry succeeds

**State Management:**
- **Server state:** SQLite database (persistent)
- **Client state:** Zustand stores (session, user, current trip) + persisted to localStorage for PWA offline resumption
- **Transient state:** Mutation queue (in-memory, cleared on success or explicit retry)
- **Client cache:** IndexedDB (scoped per user, cleared on logout)

## Key Abstractions

**Trip Aggregate:**
- Purpose: Container for a travel plan with dates, members, places, assignments, budget, packing, etc.
- Examples: `server/src/nest/trips/trips.service.ts`, `client/src/store/tripStore.ts`
- Pattern: Aggregate root pattern — all mutations flow through trip contexts; trip access checked at middleware level

**Place (POI):**
- Purpose: Point of interest (not yet on itinerary until assigned to a day)
- Examples: `server/src/nest/places/places.service.ts`, `shared/src/place/place.schema.ts`
- Pattern: Shared across all trips; categories and tags applied at the pool level

**Assignment:**
- Purpose: Links a place to a day in an ordered itinerary
- Examples: `server/src/nest/assignments/assignments.service.ts`, `shared/src/assignment/assignment.schema.ts`
- Pattern: Ordered by sequence, supports time windows, participant counts

**Day:**
- Purpose: Calendar day container within a trip (dates generated on trip creation)
- Examples: `server/src/nest/days/days.service.ts`, `shared/src/day/day.schema.ts`
- Pattern: Immutable date range set at trip creation; days auto-generated if deleted

## Entry Points

**Server:**
- Location: `server/src/index.ts`
- Triggers: Node.js start (docker, npm run dev, etc.)
- Responsibilities: Bootstrap NestJS app, set up directories, start schedulers, attach WebSocket, register graceful shutdown

**Client:**
- Location: `client/src/main.tsx`
- Triggers: Browser loads HTML (from `client/dist/index.html`)
- Responsibilities: Mount React root, wrap with BrowserRouter, initialize offline DB, start connectivity probe

**API Entry Points:**
- `GET /api/trips` → List all user's trips
- `POST /api/trips` → Create trip
- `GET /api/trips/:id` → Get trip details with all nested data
- `PUT /api/trips/:id` → Update trip metadata
- `WebSocket /ws` → Subscribe to real-time trip updates

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop; better-sqlite3 uses synchronous API so it blocks the loop during queries (this is fine for TREK's typical query latency; high-concurrency workloads would need async pooling).
- **Global state:** WebSocket rooms map, socket-user map stored in module scope; database connection proxy (`db`) is module-scoped singleton initialized on boot and re-initialized after restore.
- **Circular imports:** None known; modules organized by domain with clear dependency hierarchy (client depends on API client, server depends on database, database depends on nothing except better-sqlite3).
- **Transactions:** No explicit transaction grouping; better-sqlite3 uses autocommit mode (WAL enabled for concurrent reads). Multi-statement operations rely on ACID guarantees per statement.
- **Idempotency:** HTTP mutations must be replayed safely; `X-Idempotency-Key` header tracked server-side to return cached response on retry.
- **MFA enforcement:** Checked at WebSocket connection time and login; app-level setting can require all users enable MFA.

## Anti-Patterns

### Unvalidated responses in dev

**What happens:** API responses validated against `@trek/shared` Zod schemas only in dev mode (via `parseInDev`); production allows mismatches to pass through.

**Why it's wrong:** Production drift between server contract and client expectations can silently fail without developer awareness.

**Do this instead:** Enable schema validation in production as well, or use a separate type-only `checkInDev` wrapper if you need loose types. Reference: `client/src/api/client.ts` lines 59–85.

### Direct database queries without abstraction

**What happens:** Services use raw `db.prepare()` SQL directly, no ORM or query builder.

**Why it's wrong:** SQL construction is error-prone (parameter binding, syntax); schema changes ripple through all call sites.

**Do this instead:** Use Prisma or another ORM for structured, type-safe queries. For now, centralize queries in repository functions within the service. Reference: `server/src/db/database.ts` — `getPlaceWithTags()` is the right pattern.

### Page-level data fetching without suspense boundaries

**What happens:** Pages load data via `useEffect` on mount; loading state managed per-store; no suspense.

**Why it's wrong:** Waterfall loading (fetch, then render) causes cascading spinners and poor UX.

**Do this instead:** Use React Router's `loader` API or React 18 Suspense with a data-loading boundary. Reference: `client/src/pages/TripPlannerPage.tsx` — migrate the `useEffect` data load to a router loader.

## Error Handling

**Strategy:** Zod validation at the HTTP boundary; specific exception classes for business logic; global error envelope normalizer.

**Patterns:**
- **API validation fails** → `TrekExceptionFilter` (APP_FILTER in AppModule) catches and wraps with error envelope
- **Authorization fails** → `JwtAuthGuard` or `TripAccessGuard` throws `ForbiddenException`
- **Resource not found** → Service throws `NotFoundError`, controller catches and re-throws as `HttpException(404)`
- **Async error in mutation** → Caught in try-catch, returned to client with error message via response envelope
- **WebSocket rate limit** → Socket receives `{ type: 'error', message: 'Rate limit exceeded' }` and stays open (no close)

## Cross-Cutting Concerns

**Logging:** Via `server/src/services/auditLog.ts` — structured log to file (`/app/data/logs/trek.log`) and console; tracks auth, mutations, errors by user and IP.

**Validation:** Zod schemas at the entry point (controllers); server-side Zod validation via `parseAsync` or `parse` on request body; client-side optional `parseInDev` for development-time drift detection.

**Authentication:** JWT in httpOnly cookie + optional ephemeral token for WebSocket; session gate via `password_version` (invalidates old tokens after password change); MFA enforced at login and WebSocket handshake.

**CORS:** Global middleware via Helmet + Express CORS; allowed origins configurable via env var `ALLOWED_ORIGINS`.

**Rate limiting:** Per-socket WebSocket rate limit (30 msgs per 10 seconds); HTTP routes may have additional rate limits (check middleware).

---

*Architecture analysis: 2026-07-15*
