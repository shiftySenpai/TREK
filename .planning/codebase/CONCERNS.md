# Codebase Concerns

**Analysis Date:** 2026-07-15

## Tech Debt

**Large Monolithic Components:**
- Issue: Several frontend components exceed 2400+ lines, combining state management, event handling, rendering, and side effects in a single file
- Files: 
  - `client/src/components/Planner/DayPlanSidebar.tsx` (2485 lines) - manages day plan state, drag-drop, route calculation, notes, and reservations
  - `client/src/components/Budget/CostsPanel.tsx` (1364 lines) - budget display and editing
  - `client/src/components/Admin/AdminPluginsPanel.tsx` (1159 lines) - plugin management UI
  - `client/src/components/Map/MapViewGL.tsx` (1091 lines) - map rendering with GL layers
- Impact: Difficult to test individual concerns, high cognitive load for maintenance, increased risk of bugs when modifying features, refactoring is risky due to interconnected logic
- Fix approach: Extract custom hooks for state management (`useDayPlanSidebar` already exists), split rendering into smaller presentational components, use context/providers to reduce prop drilling

**Deep Import Paths:**
- Issue: Excessive use of relative imports with `../../../` pattern scattered throughout nested controller files, making refactoring and path reorganization risky
- Files: `server/src/nest/plugins/host/create-rpc-host.ts` and similar nested files use 3+ level relative imports
- Impact: Moving modules becomes error-prone, path consistency is hard to maintain, import statements become fragile
- Fix approach: Configure path aliases in `tsconfig.json` (e.g., `@services`, `@db`, `@utils`) to replace relative paths; enforce via linter rule

**Database Migration File Size:**
- Issue: `server/src/db/migrations.ts` is 3508 lines containing all schema migrations in a single file
- Files: `server/src/db/migrations.ts`
- Impact: Very difficult to navigate and review, slow load time, risk of merge conflicts when multiple developers add migrations, hard to roll back individual changes
- Fix approach: Split into per-version migration files or use a migration framework (Drizzle, Knex) that manages files automatically

**Type Safety with `any` Casts:**
- Issue: Multiple service files use `as any` casts for database query results, bypassing TypeScript type checking
- Files: 
  - `server/src/services/journeyShareService.ts` (11+ instances)
  - `server/src/services/adminService.ts`
  - `server/src/services/memories/immichService.ts`
  - `server/src/services/memories/synologyService.ts`
- Impact: Loss of type safety for database results, runtime errors if schema changes, harder to refactor database structure
- Fix approach: Use better-sqlite3 type helpers or create typed query wrappers that return properly typed objects instead of `any`

## Known Bugs

**Whitespace Collision Handling in Migrations:**
- Symptoms: If two users have similar usernames after trimming (e.g., " admin" and "admin"), one is renamed to `username__migrated_<id>`, breaking login for that user
- Files: `server/src/db/migrations.ts:trimUserWhitespace()` (lines 8-67)
- Trigger: Running migrations on database with leading/trailing whitespace in usernames or emails
- Workaround: Manual database correction required; users must contact admin to update email/username. System logs warn of the collision.

**ESLint Disable Comment at Top of File:**
- Symptoms: `client/src/components/Planner/DayPlanSidebar.tsx` starts with `/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */`, suppressing all type assertion warnings in the entire file
- Files: `client/src/components/Planner/DayPlanSidebar.tsx:1`
- Trigger: Loading the component
- Workaround: Developers must manually review type assertions for correctness; eslint cannot catch bad practices
- Impact: Type assertion bugs in this large component could slip through

## Security Considerations

**Dangerous HTML Rendering Pattern Mitigated:**
- Risk: `dangerouslySetInnerHTML` used in multiple places for markdown/translation rendering with user input
- Files: 
  - `client/src/i18n/TransHtml.tsx` (safe - uses `tHtml()` sanitization)
  - `client/src/components/Admin/GitHubPanel.tsx` (safe - formats release notes)
  - `client/src/components/Journey/JourneyMapGL.tsx` (safe - controlled SVG generation)
- Current mitigation: `TransHtml` component sanitizes via `rehype-sanitize` (configured in shared module), all user inputs are HTML-escaped before substitution
- Recommendations: Continue using `TransHtml` for any new templated user content; audit any new `innerHTML` assignments to ensure they don't accept user input directly

**File Upload Validation:**
- Risk: Unrestricted file uploads could lead to disk exhaustion or execution
- Files: 
  - `server/src/nest/files/files.controller.ts` (proper validation in place)
  - `server/src/services/fileService.ts`
- Current mitigation: 
  - `MAX_FILE_SIZE` (50 MB) and `MAX_VIDEO_SIZE` (500 MB) limits enforced
  - File extension whitelist (`BLOCKED_EXTENSIONS` includes `.exe`, `.sh`, etc.)
  - MIME type checks (SVG files blocked)
  - Cleanup on upload rejection
- Recommendations: Enforce rate limiting on uploads per user per time period; consider content-scanning for malware

**Ephemeral Token Session Gate:**
- Risk: Token issued before password change could be reused after password reset if token TTL not enforced
- Files: `server/src/services/ephemeralTokens.ts`, `server/src/websocket.ts:88-97`
- Current mitigation: Tokens include `password_version` snapshot; WebSocket connection rejects tokens minted with a different password version, invalidating tokens after password change
- Recommendations: Document this session-gate design clearly; add tests to verify password change invalidates all active tokens

**API Key and Secret Storage:**
- Risk: Encrypted API keys stored in database, but decryption key security depends on environment variable management
- Files: `server/src/services/apiKeyCrypto.ts`, `server/src/services/backupService.ts:173`
- Current mitigation: Secrets encrypted at rest; restore process requires matching encryption key
- Recommendations: Ensure `ENCRYPTION_KEY` env var never appears in logs or error messages; add audit logging for API key access

## Performance Bottlenecks

**Database Query N+1 Pattern in Journey Share:**
- Problem: `getPublicJourney()` loads journey, entries, and photos separately with multiple queries
- Files: `server/src/services/journeyShareService.ts:92-130`
- Cause: Multiple `db.prepare().all()` calls (entries, photos, gallery) instead of a single JOIN-based query
- Impact: 3-4 round trips to database per public journey load; scales poorly with large journeys (1000+ photos)
- Improvement path: Create a single query joining `journey_entries` → `journey_entry_photos` → `trek_photos` → `journey_photos` to fetch everything in one pass

**Promise.all() Without Error Handling:**
- Problem: `Promise.all()` used in several places fails if any promise rejects, leaving partial state
- Files: 
  - `server/src/services/placeEnrichment.ts:89` - enrichment worker pool
  - `server/src/services/notificationService.ts:209` - batch notification sends
- Impact: If one enrichment fails, all place enrichment stops; if one email fails to send, batch sends to all remaining recipients
- Improvement path: Use `Promise.allSettled()` to continue on errors, then log/retry failed items separately

**Large Component Re-renders Due to Prop Drilling:**
- Problem: `DayPlanSidebar` receives 40+ props and deep drilling causes re-renders on any prop change
- Files: `client/src/components/Planner/DayPlanSidebar.tsx:45-102`
- Impact: Entire day list re-renders when a single day expands, even if nothing else changed
- Improvement path: Use `useMemo()` for memoized sub-components, lift shared state to context (`DayPlanContext`), use React.memo on child rows

**Overpass API Rate Limiting:**
- Problem: Public Overpass API has global rate limits (15 concurrent requests); code polls mirrors sequentially on failure but may still hit limits during concurrent user searches
- Files: `server/src/services/mapsService.ts:345-390`
- Impact: Map POI searches slow down or fail during peak usage; no exponential backoff or client-side retry
- Improvement path: Implement exponential backoff with jitter, add rate limit awareness (check Overpass status before request), consider hosting local Overpass instance for heavy usage

**WebSocket Message Rate Limiting:**
- Problem: Per-connection limit is 30 messages per 10 seconds (3 msg/sec), which may be too restrictive for high-frequency updates during collaborative edits
- Files: `server/src/websocket.ts:28-29`
- Impact: Collaborative users typing fast or dragging items may hit rate limit, causing dropped updates
- Improvement path: Implement adaptive rate limiting (per-message-type), debounce client-side drag/drop, batch updates

## Fragile Areas

**Transaction Management with Synchronous Database:**
- Files: `server/src/services/assignmentService.ts`, `server/src/services/dayService.ts`, `server/src/services/settingsService.ts`
- Why fragile: Manual `BEGIN`/`COMMIT`/`ROLLBACK` calls via `db.exec()` are error-prone; if an exception occurs between BEGIN and ROLLBACK in try-catch, connection stays in transaction state
- Safe modification: Use better-sqlite3 transaction API directly (e.g., `db.transaction()` wrapper) instead of raw SQL, or wrap transaction logic in a helper function that guarantees cleanup
- Test coverage: Unit tests exist but don't cover all error scenarios (e.g., what happens if COMMIT fails?)

**File Deletion with Best-Effort Unlink:**
- Files: `server/src/services/fileService.ts:254-280`
- Why fragile: `fs.unlinkSync()` is wrapped in try-catch that silently swallows errors; if unlink fails (permission, disk, OS lock), file stays on disk but DB row is deleted or marked, leading to orphaned files
- Safe modification: Log all unlink failures with file path for later manual cleanup, implement background job to retry failed deletes, add monitoring for orphaned files
- Test coverage: No tests for unlink failure scenarios

**Import Enrichment Pass Failure Silently:**
- Files: `server/src/services/placeEnrichment.ts:161-165`
- Why fragile: If enrichment fails, error is logged but import continues with partially enriched data; no clear signal to user about incomplete enrichment
- Safe modification: Return enrichment status with each place (e.g., `enriched: boolean`), flag failed items for retry, show warning in UI if enrichment success rate < 100%
- Test coverage: No tests for partial enrichment failure

**WebSocket Heartbeat Termination:**
- Files: `server/src/websocket.ts:50-60`
- Why fragile: If a socket fails to respond to ping, `terminate()` is called, but no cleanup of room subscriptions or socket metadata occurs before removal from rooms
- Safe modification: Call `leaveAllRooms()` before `terminate()`, ensure WeakMap cleanup happens (it should via GC, but be explicit)
- Test coverage: No integration tests for heartbeat timeout scenarios

## Scaling Limits

**SQLite Database Scalability:**
- Current capacity: Single SQLite database file; scales to ~1GB before performance degrades significantly
- Limit: As TREK instances grow (100K+ trips, 10M+ photos), SQLite concurrency and query performance become bottlenecks; write contention causes BUSY errors
- Scaling path: Migrate to PostgreSQL or MySQL for production deployments; provide migration scripts, consider offering cloud-hosted option with managed database

**Photo Storage on Local Filesystem:**
- Current capacity: Uploads directory grows with every photo; no built-in cleanup for unused photos
- Limit: Disk runs out, server crashes; large trips with thousands of photos degrade performance (filesystem seeks)
- Scaling path: Implement S3/MinIO backend for photo storage, add lifecycle policies to delete old backups, add quota enforcement per trip

**In-Memory WebSocket Room Management:**
- Current capacity: All active WebSocket connections stored in memory (`rooms` Map); works for <1000 concurrent users
- Limit: Memory footprint grows linearly; server restart loses all active connections
- Scaling path: Move room state to Redis, implement automatic reconnect with session recovery, add metrics for connection pool monitoring

**Concurrency with Better-SQLite3:**
- Current capacity: Single-threaded; blocks on any write, works for <100 concurrent requests
- Limit: Under load, requests queue and timeout; no read-write separation
- Scaling path: Consider read replicas for read-heavy queries, implement query result caching layer (Redis), batch writes to reduce lock time

## Dependencies at Risk

**Better-SQLite3 Native Module:**
- Risk: Requires compilation for platform/Node version; brittle in Docker/CI environments, breaking changes in Node versions
- Impact: Deployment failures if build environment differs from target, version mismatches in CI
- Migration plan: Consider `better-sqlite3` replacement if critical bugs found; alternatives: `sql.js` (pure JS, slower), `libsql` (cloud-ready), `Knex.js` with Postgres (recommended for scale)

**Older ESLint Config (v9 / Flat Config Transition):**
- Risk: `eslint.config.js` / `eslintrc.json` patterns mix old and new formats; npm ecosystem still transitioning to flat config
- Impact: Eslint plugin compatibility issues, config inheritance bugs, friction when adding new rules
- Migration plan: Standardize on flat config format, audit all plugins for v9 support, update CI lint script

**Vite 8.1.0 (Older Minor Version):**
- Risk: `client/package.json` pins Vite to 8.1.0; current major is 5+, missing security fixes and performance improvements
- Impact: Build performance suboptimal, potential security vulnerabilities in build pipeline, incompatible with newer dependencies
- Migration plan: Audit Vite config for breaking changes, test upgraded build pipeline, plan phased upgrade (8 → current)

**React 19 Forced Across Workspace:**
- Risk: Root `package.json` overrides force React 19 on all packages, prevents selective upgrades
- Impact: If critical bug found in React 19, entire app affected; can't test with RC versions in subdependency
- Recommendation: Document override rationale, add version check in CI to catch accidental overrides

**Multer Override in Root package.json:**
- Risk: `multer@^2.2.0` override required (indicates compatibility issues); indicates a fragile dependency
- Impact: Upgrades risky, security fixes may not be applied if override constraints conflict
- Migration plan: Audit multer usage, consider `formidable` or Node.js native `node:fs` streaming as alternative

## Missing Critical Features

**No Automatic Backup Rotation:**
- Problem: Backups created on schedule but no automatic cleanup; disk fills up with old backups
- Blocks: Long-term data retention, large instance deployments
- Workaround: Manual cron job to delete old backups; documented in admin panel

**No Rate Limiting for Login Attempts:**
- Problem: Brute force attacks not prevented; no account lockout after failed attempts
- Blocks: Security for self-hosted instances without reverse proxy WAF
- Workaround: Deploy behind nginx/Apache with rate limiting rules

**No WebSocket Message Deduplication:**
- Problem: If user clicks same button twice rapidly, both messages sent; expensive operations (delete, update) may execute twice
- Blocks: Collaborative editing safety in high-latency environments
- Workaround: Client-side debouncing and optimistic UI state (already implemented for most actions)

**No Built-In Audit Trail for Sensitive Changes:**
- Problem: Admin actions (user creation, permission changes) logged but not easily queryable; hard to investigate security incidents
- Blocks: Compliance, forensics, accountability in shared instances
- Workaround: Manual database queries or third-party audit log aggregation

## Test Coverage Gaps

**WebSocket Reconnection and State Recovery:**
- What's not tested: Scenarios where client WebSocket drops mid-request and reconnects; state sync after reconnection
- Files: `server/src/websocket.ts`, `client/src/api/websocket.ts`
- Risk: Silent data loss or duplicate updates if reconnection logic has bugs
- Priority: High

**Transaction Rollback Edge Cases:**
- What's not tested: Database operations that fail mid-transaction (e.g., constraint violation during multi-step update)
- Files: `server/src/services/assignmentService.ts`, `server/src/services/dayService.ts`
- Risk: Orphaned database records or inconsistent state if rollback doesn't fully revert
- Priority: High

**File Upload Cleanup on Error:**
- What's not tested: Multer write completes but application validation fails; file must be deleted
- Files: `server/src/nest/files/files.controller.ts:106`
- Risk: Orphaned files accumulate on disk
- Priority: Medium

**Large Component Drag-Drop with Network Latency:**
- What's not tested: Dragging 50+ items across days with slow network (250ms latency); local UI vs server state divergence
- Files: `client/src/components/Planner/DayPlanSidebar.tsx` (reorder logic)
- Risk: Race condition causing wrong sort order or ghost items
- Priority: Medium

**API Rate Limiter Effectiveness:**
- What's not tested: Distributed attack from multiple IPs, WebSocket burst attacks above 30 msg/10sec limit
- Files: `server/src/websocket.ts`, `server/src/services/backupService.ts:101`
- Risk: DoS vulnerability if rates too generous or checks bypass-able
- Priority: Medium

**Concurrent Journey Photo Uploads:**
- What's not tested: Two users uploading to the same journey simultaneously; photo order consistency
- Files: `server/src/nest/journey/journey.controller.ts` (upload handler)
- Risk: Photos appear in wrong order or duplicate entries
- Priority: Low

---

*Concerns audit: 2026-07-15*
