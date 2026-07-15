# Trek Plugin Architecture & MCP Integration Patterns

## Plugin Isolation & RPC Communication

**Isolated Child Process Model**
- Plugins run in separate Node.js child processes (forked via `child_process.fork`)
- RPC-based communication: all plugin → Trek interactions via `ctx` (PluginContext) 
- Child process receives `trek-plugin-sdk` injected at runtime; zero external dependencies
- Host owns all DB handles, network credentials, secrets
- Supervisor: crash detection with heartbeat (5s interval, 20s timeout), auto-restart with exponential backoff
- RPC guards: max 100KB SQL statements, 100K row limits, 256MB plugin DB quota per plugin

## Plugin Types & Manifest

Available types: `widget`, `page`, `trip-page`, `integration`

Required manifest fields:
- `id`, `name`, `version`, `apiVersion: 1`, `type`, `permissions`, `egress` (domain allowlist)
- `requiredAddons` (e.g., `["mcp"]` if using MCP tools)
- `capabilities` (for widgets: `slot`, `title`; for exports: `provides`, `emits`)

## MCP Integration

- MCP is optional addon (`mcp` in `requiredAddons`)
- Tools available: trips, places, days, assignments, reservations, budget, packing, tags, todos, transports, collab, atlas, journey, weather, maps
- Scope enforcement: static trek_ token = full access; OAuth token = scopes restrict which tools callable
- MCP calls inherit user context; scopes bound to authenticated user

## Trip Data Access Patterns (Direct ctx API)

**Core Read/Write:**
```
ctx.trips.getById(tripId)
ctx.trips.getPlaces(tripId)
ctx.trips.update(tripId, {...})
ctx.places.create(tripId, {...})
ctx.days.create(tripId, {...})
ctx.itinerary.assign(tripId, dayId, placeId)
ctx.costs.getByTrip(tripId)
ctx.meta.set('trip', tripId, key, value)  // plugin-scoped storage
```

**Permission Model**
- Requires authenticated user (route handlers only)
- Host verifies user trip membership before allowing access
- Plugin cannot bypass permission checks
- Jobs/hooks: no user context, trip reads fail
- Separate SQLite per plugin (read-write-only within plugin's DB)

## Plugin UI Patterns

**Widget UI (Sandboxed iframe)**
- Routes defined in manifest; auth=true for user-protected routes
- Design kit CSS included (`.trek-btn`, `.trek-input`, etc.)
- Theme tokens: 40+ CSS variables synchronized with host theme in real-time
- Sandbox: `allow-scripts allow-forms` only; opaque origin (no cookie access)
- Responsive: height auto-reported; max 2000px
- Bridge: `window.trek.invoke('/route')` for plugin route calls, `window.trek.notify()` for notifications

**Page/Trip-Page UI**
- Full-page iframe, same design kit + bridge
- Icon from manifest `icon` field (Icon library names)
- Navigation: `trek.navigate('/path')` for in-app routing

**State Patterns**
- Use `ctx.meta` for persistence (plugin-scoped key/value store)
- Avoid storing state in child process memory (ephemeral on crash/restart)
- Long-running tasks use jobs (cron) not route handlers

## Plugin Settings & Configuration

- Admin sets config via `PUT /api/admin/plugins/:id/config`
- Config passed to plugin at activation in `ctx.config` (read-only)
- Secret fields encrypted at rest, returned to admin masked (`••••••••`)
- Never sent to plugin unencrypted
- Config is instance-wide, not per-trip
- Plugins cannot modify config at runtime

**Typical Config Patterns:**
- LLM provider choice + API key
- External service credentials
- Feature flags
- Model IDs

## Permission System

**Plugin-Declared Permissions:**
- Read: `db:read:trips`, `db:read:places`, `db:read:packing`, `db:read:files`, `db:read:costs`
- Write: `db:write:trips`, `db:write:places`, `db:write:days`, `db:write:itinerary`, `db:write:costs`
- Metadata: `db:meta`
- Broadcasts: `ws:broadcast:trip`, `ws:broadcast:user`
- Hooks: `hook:photo-provider`, `hook:calendar-source`, `hook:place-detail-provider`, `hook:trip-warning-provider`
- Events: `events:subscribe`
- HTTP Egress: `http:outbound` or specific domain allowlist
- Own DB: `db:own` (auto-granted plugin-private SQLite)

## Hook & Event Patterns

**Provider Hooks** (host calls plugin):
- `warningProvider` — trip validation warnings
- `placeDetailProvider` — extra info rows
- `photoProvider` — photo search/picker
- `calendarSource` — calendar event overlay

**Event Subscriptions** (plugin listens):
- Listen to: `place:created`, `day:updated`, `file:created`, etc.
- Handler runs with NO user context (like a job)

**Plugin Emissions** (plugin broadcasts):
- Declare in manifest `capabilities.emits`
- Use `ctx.events.emit('eventName', payload)`
- Other plugins can subscribe

**Plugin-to-Plugin Calls** (RPC):
- Declare in `capabilities.provides`
- Export async functions
- Call via `ctx.plugins.call('plugin-id', 'functionName', args)`

## Lifecycle Management

**Activation Flow:**
1. Admin: POST `/api/admin/plugins/:id/activate`
2. Runtime: fork child process
3. Child: load plugin module, run `onLoad(ctx)`
4. Child: send heartbeat, report routes/hooks/jobs
5. Parent: verify addon/permission/dependency requirements
6. Parent: set status='active'

**Crash & Recovery**
- Automatic restart with exponential backoff (initial → 30s max)
- After 5 crashes in 5min: mark 'error', stop restarting
- Admin must manually reactivate

**Graceful Shutdown**
- Call `onUnload(ctx)` if defined
- 3s grace period; then SIGKILL
- Cannot delay deactivation

**Configuration Hot-Reload**
- No automatic reload on config change
- Admin: deactivate → update config → reactivate

## Key Trek Conventions for Chatbot Plugin

1. **State Management**: Use `ctx.meta`, not child process memory
2. **Async Operations**: Long-running tasks via jobs, not route handlers
3. **Error Handling**: Log via `ctx.log`, throw in handlers → 500
4. **User Context**: Route handlers have `req.user`; jobs/events have none
5. **Database**: Use `ctx.trips.*`, never fork own DB client
6. **Testing**: `createMockHost()` from SDK testing module enforces permission model
7. **Widget Height**: Report via `trek.notify()` or auto-measuring
8. **Theme Sync**: Listen to `trek.onContext()` for live theme/appearance updates
