# External Integrations

**Analysis Date:** 2026-07-15

## APIs & External Services

**Mapping & Geocoding:**
- **Google Places API (New)** - Place search, autocomplete, details, photos, ratings
  - SDK/Client: Native `fetch` (HTTP calls via `server/src/services/mapsService.ts`)
  - Auth: API key (`MAPS_API_KEY` env var or per-user key stored encrypted)
  - Usage: `getMapsKey()` resolves key from env → user → admin → null (fallback to OSM)
  - Files: `server/src/services/mapsService.ts` (lines 6–18, 145–152)
  - Rate limiting: Call counter tracked in memory (`googleApiCallCount`)

- **OpenStreetMap (Nominatim)** - Address lookup, reverse geocoding, search
  - Endpoint: `https://nominatim.openstreetmap.org/`
  - Auth: None (public, rate-limited by User-Agent)
  - Usage: `searchNominatim()`, `lookupNominatim()` in `mapsService.ts`
  - Files: `server/src/services/mapsService.ts` (lines 155–214)
  - User-Agent: Built with instance URL for identification (`buildUserAgent()`)

- **Overpass API** - OSM place-of-interest search (restaurants, hotels, attractions)
  - Endpoints: Multiple mirrors for failover/load balancing
    - Default: `https://overpass-api.de/`, `https://maps.mail.ru/osm/tools/overpass/`, etc.
    - Custom: Via `OVERPASS_URL` env var (comma-separated)
  - Auth: None (public, query-based rate limiting)
  - Usage: `searchOverpassPoi()` for the "explore on map" feature
  - Files: `server/src/services/mapsService.ts` (lines 235–390, 295–327)
  - Concurrency: Queries race against all mirrors; first valid response wins
  - Cache: 5-minute in-memory POI cache per viewport (`POI_CACHE`, 500 entries max)
  - Timeout: `OVERPASS_TIMEOUT_MS` env var (default 12s per mirror)

**Weather:**
- **Open-Meteo** - Weather forecasting (free, no API key required)
  - Endpoint: `https://api.open-meteo.com/`
  - Auth: None
  - Usage: Daily/hourly weather, sunrise/sunset, precipitation, wind via WMO codes
  - Files: `server/src/services/weatherService.ts`

**Photos & Image Search:**
- **Unsplash API** - Trip cover & place image search
  - Endpoint (authenticated): `https://api.unsplash.com/search/photos`
  - Endpoint (unauthenticated): `https://unsplash.com/napi/search/photos`
  - Auth: Optional `UNSPLASH_ACCESS_KEY` (Client-ID header)
  - Usage: `searchUnsplashPhotos()` for image selection
  - Files: `server/src/services/unsplashService.ts`
  - Key resolution: Env var → user → admin → null (unauthenticated endpoint fallback)
  - Download: `saveUnsplashCover()` fetches from `images.unsplash.com` CDN and caches locally

- **Wikimedia Commons** - Photo metadata & attribution (via placePhotoCache)
  - Endpoint: `https://commons.wikimedia.org/w/api.php`
  - Usage: Photo metadata lookup for OSM-sourced images
  - Files: `server/src/services/placePhotoCache.ts`
  - Cache: Disk-backed photo cache with versioning

**Email & Notifications:**
- **SMTP** - Transactional email (password reset, trip reminders, notifications)
  - Configuration: Via env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) or app settings DB
  - Client: Nodemailer
  - Usage: `getSmtpConfig()` in `notifications.ts`; `nodemailer.createTransport()` for sending
  - Files: `server/src/services/notifications.ts` (lines 44–52)
  - Encryption: `SMTP_PASS` stored encrypted in DB when set via admin panel
  - Precedence: Env vars override database settings

## Data Storage

**Databases:**
- **SQLite** (via better-sqlite3)
  - Connection: `server/src/db/database.ts` (Proxy pattern wrapping better-sqlite3)
  - Database file: `/app/data/travel.db` (can be overridden via `TREK_DB_FILE` env var)
  - Journal mode: WAL (Write-Ahead Logging) for concurrent access
  - Pragmas:
    - `PRAGMA journal_mode = WAL` - WAL journaling
    - `PRAGMA busy_timeout = 5000` - 5s timeout on lock contention
    - `PRAGMA foreign_keys = ON` - Referential integrity
  - Test mode: In-memory `:memory:` DB per Vitest worker
  - Schema: `server/src/db/schema.ts` (22.5 KB)
  - Migrations: `server/src/db/migrations.ts` (149.3 KB)
  - Seeds: `server/src/db/seeds.ts` (demo/default data)
  - Backup: Exported as ZIP to `/app/data/backups/` on-demand
  - Restore: Injects new DB, runs migrations, reinitializes

**File Storage:**
- **Local filesystem** (default)
  - Directories:
    - Photos: `/app/uploads/photos/`
    - Trip files: `/app/uploads/files/`
    - Covers/artwork: `/app/uploads/covers/`
    - Avatars: `/app/uploads/avatars/`
  - Creation: `server/src/index.ts` lines 9–20
  - Served via `/uploads/*` static routes with SSRF guards
  - No external cloud storage integration

**Caching:**
- **In-Memory (server)**
  - POI cache: 5-min TTL, 500-entry max (`mapsService.ts`)
  - Photo fetch semaphore: Concurrent request limiter
  - Auth code store: Short-lived pending OAuth codes
  - MCP session cache: User sessions with configurable TTL
- **IndexedDB (client)**
  - Dexie wrapper for offline-first data caching
  - Syncs with server on reconnect
  - Local data: Trips, places, assignments, etc.

## Authentication & Identity

**Auth Provider:**
- **Multiple strategies** (custom, no single external provider required)
  - Password login → JWT token (`jsonwebtoken`)
  - WebAuthn/Passkey → FIDO2 server verification (`@simplewebauthn/server`)
  - OIDC → External IdP (`oauthService.ts`, `oidcService.ts`)
  - MCP OAuth 2.1 → Custom OAuth authorization code flow

**JWT:**
- Token generation: `jsonwebtoken` library
- Secret: Auto-generated & persisted to `/app/data/.jwt_secret` on first start
- TTL configurable: `SESSION_DURATION` (default 24h), `SESSION_DURATION_REMEMBER` (default 30d)
- Files: `server/src/config.ts` (JWT secret management), `server/src/services/authService.ts` (signing)

**WebAuthn:**
- Library: `@simplewebauthn/server` (server) + `@simplewebauthn/browser` (client)
- Flow: User registration & authentication via FIDO2
- Config: `server/src/services/passkeyService.ts`, `server/src/services/webauthnConfig.ts`
- Challenge: Server generates & validates ceremonies

**OpenID Connect:**
- Config env vars:
  - `OIDC_ISSUER` - IdP endpoint
  - `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` - Credentials
  - `OIDC_DISPLAY_NAME` - SSO button label
  - `OIDC_SCOPE` - OpenID/email/profile/custom scopes
  - `OIDC_ADMIN_CLAIM`, `OIDC_ADMIN_VALUE` - Admin role mapping
  - `OIDC_DISCOVERY_URL` - Non-standard discovery endpoint override
  - `OIDC_ONLY` - Force SSO-only mode (disable password login)
- Implementation: `server/src/services/oidcService.ts` (21.5 KB)
- Stored encrypted: `oidc_client_secret` in DB when set via admin panel

**MFA:**
- **TOTP** - Time-based one-time passwords
  - Library: `otplib`
  - Storage: Encrypted seed in user record
  - Challenge token: Short-lived JWT for MFA verification
  - File: `server/src/services/authService.ts`

**OAuth 2.1 (MCP):**
- Authorization code flow with PKCE (RFC 7636)
- Clients: Registered in `oauth_clients` table
- Tokens: `access_token` (1h TTL), `refresh_token` (30d rolling)
- Files: `server/src/services/oauthService.ts` (80+ lines)
- Endpoints: `/oauth/authorize`, `/oauth/token`, `/oauth/consent` (via routes)

**Encryption:**
- At-rest key: `ENCRYPTION_KEY` env var (or auto-generated at `/app/data/.encryption_key`)
- Uses: API keys, SMTP password, OIDC client secret, MFA TOTP seeds
- Separate from JWT secret (allows independent rotation)
- Files: `server/src/services/apiKeyCrypto.ts`, `server/src/config.ts`

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, DataDog, etc.)

**Logs:**
- Console logging via `console.log/warn/error`
- Audit logging: `server/src/services/auditLog.ts`
  - User actions, auth events, admin changes logged to SQLite `audit_logs` table
  - Rotation: Configured via `startAuditLogRotation()` (30-day retention default)
- Log level: `LOG_LEVEL` env var (info, debug, warn, error)
- File logging: `/app/data/logs/trek.log` (mentioned in startup banner)
- Request logging: Global middleware logs HTTP requests/responses

**Health Check:**
- Endpoint: `GET /api/health`
- Probe: Docker HEALTHCHECK uses `wget -qO- http://localhost:3000/api/health`
- Interval: 30s, timeout 5s, 3 retries, 15s startup grace

## CI/CD & Deployment

**Hosting:**
- Docker container image: `mauriceboe/trek:dev` (published to Docker Hub)
- Deployment: Single container (monolithic); no microservices
- Compose example: `docker-compose.yml` provided

**Build Environment:**
- Multi-stage Docker build (`Dockerfile`):
  - Stage 1: Build shared package (tsdown → CJS + ESM)
  - Stage 2: Build client (Vite → static assets)
  - Stage 3: Build server (tsc → Node.js bundle)
  - Stage 4: Runtime (node:24-trixie-slim base, native bindings)
- Prebuilt binaries: `@img/sharp-*-musl`, `@rollup/rollup-linux-*-musl` for container builds
- Base image: `node:24-alpine` (build), `node:24-trixie-slim` (runtime)

**CI Pipeline:**
- Not detected in this codebase (check `.github/workflows/` if present)

## Environment Configuration

**Required env vars:**
- `ENCRYPTION_KEY` - At-rest encryption (recommended; auto-generated if unset)
- `APP_URL` - Public base URL (required when OIDC enabled)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` - Initial admin (first boot only)

**Optional env vars:**
- `PORT` (default 3000), `HOST` - HTTP listen address
- `NODE_ENV` - `production` / `development` / `test`
- `LOG_LEVEL` - Log verbosity
- `TZ` - Timezone for logs and scheduled tasks
- `DEFAULT_LANGUAGE` - Login page language (en/de/es/fr/etc.; default en)
- `SESSION_DURATION`, `SESSION_DURATION_REMEMBER` - Auth token lifetime
- `ALLOWED_ORIGINS` - CORS origins (comma-separated)
- `FORCE_HTTPS`, `TRUST_PROXY`, `HSTS_INCLUDE_SUBDOMAINS` - TLS/proxy headers
- `DEMO_MODE` - Enable demo data & reset scheduler (true/false)
- `OIDC_*` - OpenID Connect credentials & config
- `SMTP_*` - Email configuration
- `UNSPLASH_ACCESS_KEY` - Optional Unsplash API key
- `MAPS_API_KEY` - Optional Google Places API key (can also be per-user)
- `OVERPASS_URL`, `OVERPASS_TIMEOUT_MS` - Custom Overpass mirrors & timeout
- `KITINERARY_EXTRACTOR_PATH` - Path to kitinerary-extractor binary
- `MCP_RATE_LIMIT` - MCP API request limit per user/min (default 300)
- `MCP_MAX_SESSION_PER_USER` - Max concurrent MCP sessions per user (default 20)
- `MCP_SESSION_TTL` - MCP session timeout
- `ALLOW_INTERNAL_NETWORK` - Allow RFC-1918 IPs for Immich/local services

**Secrets location:**
- Environment variables (recommended)
- Database: Encrypted columns in `users` table (`maps_api_key`, `unsplash_api_key`, `oidc_client_secret`, `smtp_pass`)
- File system: `/app/data/.encryption_key`, `/app/data/.jwt_secret` (auto-generated/persisted)

## Webhooks & Callbacks

**Incoming:**
- MCP tools: Bidirectional protocol (clients call server tools)
- WebSocket: Real-time updates for collaborative trips (`server/src/websocket.ts`)
- OAuth 2.1 callback: `/oauth/callback` (clients redirect after authorization)

**Outgoing:**
- Email notifications: Trip reminders, password resets (Nodemailer SMTP)
- No outbound webhooks detected (e.g., no Slack, Discord, GitHub integrations)

## Data Import/Export

**Import:**
- **KML files** - Travel itinerary import via `kmlImport.ts`
- **Travel itineraries** - Via kitinerary-extractor (PDF booking confirmations, etc.)
- **CSV/JSON** - Backup restore (ZIP format)

**Export:**
- **Backup** - Full SQLite DB export as ZIP (encrypted when requested)
- **Travel itineraries** - PDF generation via `@react-pdf/renderer`
- **GeoJSON** - Place data for maps

## SSRF & Security Guards

**SSRF Prevention:**
- Custom SSRF guard: `server/src/utils/ssrfGuard.ts`
  - `safeFetch()` - Validates URLs, blocks RFC-1918 (unless `ALLOW_INTERNAL_NETWORK=true`), loopback, link-local
  - `createPinnedDispatcher()` - Pins DNS to prevent time-of-check-to-time-of-use attacks
  - Used by: Unsplash CDN fetch, Overpass queries, all external API calls
- Helmet CSP headers: Restrict external resource loading

## Rate Limiting

**MCP API:**
- `MCP_RATE_LIMIT` env var (default 300 requests/user/min)
- Token bucket algorithm (sliding window)
- Implemented in `server/src/mcp/` session manager

**Nominatim/Overpass/Unsplash:**
- Rate-limited by User-Agent
- Instance URL appended to User-Agent for fair rate-limit quotas

---

*Integration audit: 2026-07-15*
