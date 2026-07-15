# AI Chatbot Plugin — Roadmap

## Overview

Production MVP in 3–4 weeks. Structured as 4 phases with clear dependencies and go-live readiness criteria.

| Phase | Timeline | Focus | Go-Live Ready |
|-------|----------|-------|---------------|
| **1** | Week 1-2 | Architecture, skeleton, basic chat | No |
| **2** | Week 2-3 | MCP integration, trip data, persistence | No |
| **3** | Week 3 | Streaming, error handling, polish | **Yes** |
| **4** | Week 4 (optional) | Proactive features, optimization | Enhanced |

---

## Phase 1: Core Architecture & Skeleton (Week 1-2)

**Goal:** Fully functional Trek plugin with basic chat UI and LLM integration. Single round-trip message flow working end-to-end.

### Architecture Setup

- **P1.A1** — Project scaffolding
  - Initialize Trek plugin via `trek-plugin create ai-chatbot --type trip-page`
  - Manifest setup: id, name, version, apiVersion, permissions (db:own, ws:broadcast:trip, db:meta), required addons (mcp)
  - Directory structure: `server/`, `client/`, `docs/`, `trek-plugin.json`, `README.md`, `package.json`
  - Git: initialize repo, initial commit with plugin skeleton
  - Requirements: F1-F8 (architecture layer)

- **P1.A2** — Plugin server entry point
  - `server/index.js`: exports plugin definition (routes, hooks, onLoad, onUnload)
  - onLoad: initialize plugin DB (`ctx.db.migrate`), set up logging
  - Routes: `/chat` (POST, chat handler), `/config` (GET, plugin settings), `/models` (GET, model discovery)
  - PluginContext mock testing framework via SDK
  - Requirements: C1, NF2

### LLM Integration (Basic)

- **P1.B1** — LLM client abstraction
  - Abstract client interface supporting OpenAI-compatible API + Anthropic
  - Support local (baseUrl parameter) and cloud providers
  - Default to AI Parsing addon config (hybrid mode)
  - Methods: `chat(messages, model, provider)`, `getModels(provider)` (for discovery)
  - Token counting for context window management (approximate)
  - Requirements: F2.1, F2.2, F2.3, F2.4, C3

- **P1.B2** — Chat completion handler
  - `routes.push({ method: 'POST', path: '/chat', auth: true, handler(req, ctx) {...} })`
  - Receive: `{ tripId, message, model?, provider? }`
  - Resolve LLM config (default from addon, override if provided)
  - Build LLM request: simple system prompt + user message history
  - Call LLM via client, catch errors, return streamed response (non-streaming for MVP, streaming in phase 3)
  - Requirements: F2, F4.3, F5.1

### Chat UI (Basic)

- **P1.C1** — Widget button + modal scaffold
  - Client entry: `client/index.html` with `<!-- trek:ui -->` marker
  - Widget footer button: 64px circular, unread badge, click to toggle modal
  - Modal: 380-420px sidebar (desktop), collapsible/dismissable
  - Hardcoded trip ID for now (phase 2: dynamic context)
  - State: simple React component or vanilla JS (user preference)
  - Requirements: F1.1, F8.1, F8.3

- **P1.C2** — Message list & input
  - Display messages: user (right-aligned, primary color) vs. bot (left-aligned, surface-secondary)
  - Message timestamps on hover (desktop) / always (mobile)
  - Input textarea with send button
  - Scroll: scroll to bottom on new message
  - Local state management (messages in component state, not yet persisted)
  - Requirements: F1.2, F1.4, F4.1

- **P1.C3** — Theme & design tokens
  - Import Trek's color/typography tokens via `window.trek.onContext()`
  - Apply colors: `bg-primary-500`, `bg-surface-card`, `text-body`, `text-caption`
  - Responsive layout: desktop sidebar, tablet modal (90vw), mobile full-screen
  - CSS layout (grid/flex), no external UI library (rely on trek:ui kit)
  - Dark mode: CSS variables handle automatically
  - Requirements: F8.1, F8.3, NF2

### Testing & Development Setup

- **P1.D1** — Local dev workflow
  - `trek-plugin dev` command operational (dev server running)
  - Hot reload on file changes
  - Mock ctx with permission model enforced
  - /api routes serve, /ui at `/ui/index.html`
  - Able to test chat flow locally without full Trek instance

- **P1.D2** — Basic integration test
  - Manual test: chat with hardcoded trip ID
  - Verify LLM call (mock LLM for testing)
  - Verify message display (no persistence yet)
  - Verify error toast on LLM failure

### Phase 1 Deliverables

- ✅ Trek plugin scaffolding complete
- ✅ LLM client (OpenAI-compatible + Anthropic) working
- ✅ Chat handler `/chat` route operational
- ✅ Widget + modal UI showing messages
- ✅ Single round-trip message flow end-to-end
- ✅ Theme tokens applied, responsive layout working
- ✅ Local dev server running, manual testing OK

**Not done yet:** Persistence, MCP integration, trip context, streaming, error handling polish

**Key risk:** LLM config resolution — verify hybrid mode (default to addon, allow override) works correctly

---

## Phase 2: MCP Integration & Trip Data (Week 2-3)

**Goal:** Chatbot can query trip data via MCP, store chat history, manage user permissions for MCP tools.

### Trip Context & MCP Setup

- **P2.A1** — Trip context selection & loading
  - UI: trip selector (dropdown or modal) for non-hardcoded trip
  - Or: infer current trip from Trek's active context (if available in plugin context API)
  - Load trip summary: name, dates, members, budget total, packing %, todos count
  - Display trip card (sticky, collapsible) at top of chat
  - Requirements: F1.2, F3.1, F4.1

- **P2.A2** — MCP tool integration
  - Declare MCP addon as required: `requiredAddons: ["mcp"]` in manifest
  - Plugin permissions for MCP scopes: `db:read:trips`, `db:read:places`, `db:read:packing`, etc.
  - Implement MCP tool calling via Trek's MCP bridge (if available in plugin SDK)
  - Or: route calls through Trek backend via `/api/mcp/:tool` proxy endpoint
  - Build LLM system prompt to reference available MCP tools (for next phases)
  - Requirements: F3.1, F3.2, C2, C4

- **P2.A3** — Permission configuration UI
  - Settings route: `GET /config` returns current MCP scope config
  - Admin UI: checkboxes for which MCP tools chatbot can access
  - User override: per-plugin instance, allow enabling/disabling specific tools
  - Store config in plugin metadata or instance config
  - Requirements: F7.2, F3.2

### Chat Persistence

- **P2.B1** — Metadata storage setup
  - Use `ctx.meta.set('trip', tripId, 'chat_history', [...])` to store messages
  - Message schema: `{ id: uuid, role: 'user'|'assistant', content: string, timestamp: iso8601 }`
  - Store/retrieve via plugin-scoped metadata (Trek enforces namespace)
  - Migration: handle existing empty metadata (init on first message)
  - Requirements: F6.1, C6, [[Plugin-Cookbook.md#tag-a-core-entity---no-schema-fork]]

- **P2.B2** — History loading on init
  - On widget open: load existing messages from metadata (pagination 25-50)
  - Append new messages as conversation continues
  - Clear history: delete metadata key (with confirmation modal)
  - Requirements: F1.2, F6.1

- **P2.B3** — Context window management
  - Track message count; after 50+, start archiving old turns
  - Truncate context if LLM token count approaches limit (estimate via prompt tokens)
  - Don't lose messages locally, just summarize old ones (or store in separate archive metadata key)
  - Requirements: F4.3, NF4

### LLM Context Building

- **P2.C1** — System prompt & context injection
  - System prompt: role description + available actions + MCP tool reference
  - Inject trip context: "This is a trip to {destination} from {start} to {end}. You have access to: places, budget, packing, todos."
  - Keep injected context minimal (~500 tokens) to preserve conversation tokens
  - Dynamically adjust based on what user is asking about
  - Requirements: F2.4, F4.3

- **P2.C2** — Conversation history building
  - Build messages array: system prompt + recent 10-20 messages from metadata
  - Truncate old messages if total token count exceeds 2000 (configurable)
  - Balance: enough history for context, not overwhelming the LLM
  - Requirements: F4.3, F2.4

### Model Discovery & Selection

- **P2.D1** — Model discovery endpoint
  - `GET /models?provider=local` → query Ollama at `/api/tags`
  - `GET /models?provider=openai` → return hardcoded OpenAI models (gpt-4, gpt-4o, etc.)
  - `GET /models?provider=anthropic` → return hardcoded Anthropic models
  - Cache results (TTL 30min)
  - Requirements: F2.2, C3

- **P2.D2** — Model selector UI
  - Settings/config panel: dropdown to select model
  - Initially populated from AI Parsing addon default
  - User can switch without editing config (stored in plugin instance settings)
  - Requirements: F2.1, F7.1, F7.2

### Phase 2 Deliverables

- ✅ Trip context loading (selector + summary card)
- ✅ MCP addon required, permissions declared
- ✅ Chat history persisted to trip metadata
- ✅ Permission config UI (which MCP tools accessible)
- ✅ Model discovery working (local + cloud)
- ✅ System prompt + context injection in LLM calls
- ✅ Context window management (truncate old messages)
- ✅ Clear history button with confirmation

**Not done yet:** Streaming, error handling polish, proactive features, full MCP tool access

**Key risk:** Context window management — ensure LLM doesn't choke on truncated context

---

## Phase 3: Streaming, Polish & Go-Live (Week 3)

**Goal:** Production-ready MVP. Streaming responses, robust error handling, full UI polish, test coverage.

### Streaming Responses

- **P3.A1** — Streaming endpoint
  - Modify `/chat` route to return Server-Sent Events (SSE) stream
  - Client opens EventSource connection
  - Server: call LLM, stream tokens as they arrive, send `data: {...token...}` events
  - Client: accumulate chunks, append to message in real-time
  - Requirements: F1.3, F4.3, NF1

- **P3.A2** — Streaming UI
  - Display message as it's being assembled (token-by-token)
  - Cursor indicator (blinking underline) during streaming
  - "Stop generating" button → send abort signal to LLM (cancel mid-stream)
  - Partial message kept if user cancels
  - Skeleton loading state before first token
  - Requirements: F1.3, F5.1

- **P3.A3** — Timeout & cancellation handling
  - AbortController for LLM call (30s cloud, 300s local)
  - On timeout: send error message to client, allow retry
  - On user cancel: stop streaming, keep what was generated
  - Requirements: F2.4, F5.1, NF1

### Error Handling & User Feedback

- **P3.B1** — Toast notifications
  - Success toast: "Added to packing ✓" (auto-dismiss 3s)
  - Error toast: "Connection lost [Retry]" (persist until dismissed)
  - Info toast: "Loading trip data..." (spinner)
  - Toast positioning: bottom-left (above input)
  - Requirements: F5.2, F5.3, [[CHAT_UI_PATTERNS.md#error-ux]]

- **P3.B2** — LLM error scenarios
  - Rate limit: "You've sent many. Wait a moment." → auto-retry 30s
  - Token limit: "Message too long. Try shorter question." → [Clear history] button
  - Model overloaded: "Assistant is busy. Retrying..." → show retry count
  - Provider down: "Can't connect to LLM. Retry?" → [Retry] button
  - Content policy violation: "I can't help with that." → no retry
  - Requirements: F5.1, [[CHAT_UI_PATTERNS.md#error-ux]]

- **P3.B3** — Permission error messaging
  - MCP scope denied: "I can see your packing list but don't have permission to add items. [Authorize]"
  - No trip access: "You don't have access to Trip X. Ask owner to add you."
  - OAuth re-consent: if new scope needed, direct user to [Authorize packing:write]
  - Requirements: F5.2, F3.2

### UI Polish & Accessibility

- **P3.C1** — Keyboard navigation
  - Tab through: widget button → input → send button → modal dismiss
  - Enter to send, Shift+Enter for newline
  - Cmd+K (Mac) / Ctrl+K (Windows) to toggle widget
  - Escape to close modal
  - Requirements: F8.2, F1.4

- **P3.C2** — ARIA & screen reader support
  - ARIA labels on widget button ("Unread: 2")
  - Live regions: `aria-live="polite"` on message list
  - Typing indicator: "Assistant is thinking..."
  - Error toast: announced to screen reader
  - Requirements: F8.2

- **P3.C3** — Mobile optimizations
  - Touch targets: 44px+ height on buttons
  - Virtual keyboard: doesn't push chat off-screen
  - Gesture: swipe down to dismiss modal
  - Orientation: preserve scroll + draft text when rotating
  - Requirements: F8.3, F1.1

- **P3.C4** — Theme consistency
  - Verify dark mode (CSS variables auto-handle)
  - Link colors, code block styling, emoji rendering
  - Contrast: 4.5:1 text, 3:1 UI elements (test via WebAIM)
  - Requirements: F8.1

### MCP Tool Integration (Read-Only)

- **P3.D1** — Callable MCP tools
  - Expose to chatbot: `get_trip_summary`, `list_places`, `get_weather`, `list_todos`, `get_settlement_summary`
  - Chatbot can call these from LLM function calling (if LLM supports tool use)
  - Or: summarize tool capabilities in system prompt for zero-shot LLM decision-making
  - Requirements: F3.1, F3.3

- **P3.D2** — Tool call results in context
  - When chatbot needs to answer a question, it calls MCP tool
  - Include tool result in next LLM turn: "Based on your trip data: ..."
  - Handle tool errors gracefully (missing data, permission denied)
  - Requirements: F3.3, F5.2

### Testing & Documentation

- **P3.E1** — Manual test plan
  - Chat flow: greeting → context → multi-turn conversation
  - LLM error scenarios: rate limit, timeout, provider down
  - Permission scenarios: MCP scope denied, no trip access
  - UI: widget open/close, modal responsive, theme toggle
  - Accessibility: keyboard nav, screen reader, touch targets

- **P3.E2** — README & user docs
  - How to install plugin (admin panel, sideload, or registry)
  - How to configure: LLM provider, model, MCP tool permissions
  - How to use: trip selector, chat, clear history
  - Keyboard shortcuts, known limitations
  - Requirements: [[Plugin-Publishing.md]]

### Phase 3 Deliverables

- ✅ Streaming responses (token-by-token)
- ✅ Stop generation button
- ✅ Toast notifications (success, error, loading)
- ✅ LLM error handling with retry (5 scenarios)
- ✅ Permission error messaging
- ✅ Keyboard navigation (Tab, Enter, Cmd+K, Escape)
- ✅ ARIA labels + screen reader support
- ✅ Mobile optimization (touch, orientation, keyboard)
- ✅ Dark mode verified
- ✅ MCP read-only tools callable
- ✅ README + user docs
- ✅ Manual testing passed
- ✅ **Go-Live Ready**

**Not done yet:** Write operations, proactive suggestions, API rate limiting, analytics

**Key risk:** Streaming implementation — ensure no memory leaks on long-running streams, client reconnection handling

---

## Phase 4: Enhanced Features & Optimization (Week 4, Optional)

**Goal:** Production hardening. Write operations, proactive suggestions, performance tuning, monitoring.

### Write Operations (MCP)

- **P4.A1** — Writable MCP tools
  - Chatbot can call: `create_todo`, `create_packing_item`, `create_budget_item`, `create_place`
  - Require confirmation for destructive actions: "This will add X. Ready? [Confirm] [Cancel]"
  - Non-destructive: instant execution + undo toast (5s window)
  - Requirements: F3.4, F4.5

- **P4.A2** — Structured action cards
  - Packing suggestions: "Suggested items: [Sunscreen +] [Rain jacket +]" (each is separate button)
  - Reservation card: flight info + [Add to trip] button
  - Budget summary: "Current: $8,940 (71%) | Remaining: $3,660 [View] [Adjust]"
  - Requirements: F4.5

### Proactive Suggestions

- **P4.B1** — Suggestion triggers
  - Trip just created: "Want me to help plan your itinerary?" (once per trip)
  - User mentions weather: "I can suggest packing for 28°C." (context-aware)
  - Budget >85% spent: "Your budget is getting tight." (alert)
  - Packing 0% + 2 days before trip: "Your packing list is empty. Need help?" (reminder)
  - Requirements: F4.4, NF2

- **P4.B2** — Suggestion UX
  - Render as collapsible cards below bot message (not intrusive)
  - Card header: "Suggestion" badge + title
  - Card content: 2-3 sentence proposal + single action button
  - Dismissible (✕ button) without closing chat
  - Track dismissed suggestions (don't re-show same suggestion for 24h)
  - Requirements: F4.4, [[CHAT_UI_PATTERNS.md#proactive-assistance]]

- **P4.B3** — Confidence signaling
  - Uncertain: "Based on dates, I'd recommend X. Note: weather is approximate." (note in lighter text)
  - Likely vs. Possibly vs. "I'm not sure but..."
  - Data permission limitation: "I can see packing but can't add items. [Authorize]"
  - Requirements: F4.4, [[CHAT_UI_PATTERNS.md#proactive-assistance]]

### Performance Tuning

- **P4.C1** — Message pagination optimization
  - Load 25 msgs per request (not full history)
  - Virtualization: render only visible messages (not all 1000+)
  - Lazy-load older messages on scroll up
  - Requirements: NF1

- **P4.C2** — LLM latency optimization
  - Cache trip summary (TTL 5min) to avoid repeated MCP calls
  - Batch tool calls where possible (if LLM does parallel tool use)
  - Streaming: start token output <100ms for cloud, <2s for local
  - Requirements: NF1

- **P4.C3** — Database optimization
  - Index metadata queries on trip_id (fast history loads)
  - Prune archived messages (older than 90 days)
  - Measure query performance, optimize N+1 patterns
  - Requirements: NF3, NF4

### Monitoring & Logging

- **P4.D1** — Error logging
  - Log all LLM calls: provider, model, tokens, latency, success/failure
  - Log MCP tool calls: tool name, result, errors
  - Log permission denials: user, trip, scope
  - Centralize to Trek's plugin error log (via `ctx.log`)
  - Requirements: NF2, C5

- **P4.D2** — Metrics
  - Track: chat initiation rate, avg response latency, error rate, retry rate
  - Dashboard: simple table or graph of daily metrics
  - Alert on: error rate >5%, latency p99 >5s
  - Requirements: NF1, NF4

### Security & Hardening

- **P4.E1** — Input sanitization
  - Validate user message length (max 2000 chars)
  - Escape/sanitize before displaying in chat
  - Rate limit: max 20 messages per hour per user (configurable)
  - Requirements: F5, NF3

- **P4.E2** — API key security
  - Verify encryption at rest (Trek's apiKeyCrypto)
  - No API keys in logs or error messages
  - Masked in admin UI (••••••••)
  - Audit: log who accessed plugin settings (if API key involved)
  - Requirements: F7.3, C3, NF3

- **P4.E3** — MCP permission audit
  - Log which tools chatbot calls on behalf of user
  - Verify no permission escalation (user can't call tools they're not scoped for)
  - Audit report: generated on demand by admin
  - Requirements: F3.2, NF3

### Phase 4 Deliverables (Optional, for continued development)

- ✅ Write operations (create todo, packing, budget, place)
- ✅ Confirmation modal for destructive actions
- ✅ Undo toast for non-destructive actions
- ✅ Structured action cards (packing, reservations, budget)
- ✅ Proactive suggestions (4 trigger patterns)
- ✅ Suggestion dismissal (don't re-show for 24h)
- ✅ Confidence signaling & permission messaging
- ✅ Message virtualization (only render visible msgs)
- ✅ LLM call caching (trip summary TTL 5min)
- ✅ Database index optimization
- ✅ Error logging to plugin error log
- ✅ Metrics dashboard (daily chat stats)
- ✅ Input sanitization + rate limiting
- ✅ API key audit logging
- ✅ MCP permission audit report

---

## Dependency Graph

```
Phase 1 (Architecture, LLM, Basic Chat)
  ↓
Phase 2 (MCP, Trip Context, Persistence)
  ↓
Phase 3 (Streaming, Error Handling, Polish) ← **Go-Live Ready**
  ↓
Phase 4 (Write Ops, Proactive, Optimization) ← Optional Enhancement
```

**Critical Path:** P1 → P2 → P3 (3 weeks). Phase 4 optional for production robustness (week 4).

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LLM config resolution (hybrid mode broken) | High | P1: Unit test hybrid mode (default to addon, override works) |
| MCP tool calling fails | High | P2: Start with mock MCP tools, switch to real tools incrementally |
| Context window management too aggressive | Medium | P2: Log context truncation, manual test with 100+ message convos |
| Streaming memory leak on long streams | Medium | P3: Test with 10min+ streams, measure memory, implement backpressure |
| Touch target too small on mobile | Low | P3: Verify 44px+ via lighthouse, manual test on iPhone |
| API key leakage in logs | Critical | P1: Grep codebase for API key patterns, use encryption library test |

---

## Success Criteria by Phase

### Phase 1
- ✅ Plugin scaffolds successfully
- ✅ LLM call works end-to-end (hardcoded message)
- ✅ Chat UI displays message
- ✅ Local dev server runs

### Phase 2
- ✅ Trip context loaded (trip selector + summary card visible)
- ✅ Chat history persisted to metadata (reload and see old messages)
- ✅ MCP addon required (plugin won't activate without addon)
- ✅ Model selector working (dropdown populated from local/cloud)

### Phase 3 (Go-Live)
- ✅ Streaming messages display token-by-token (<100ms latency)
- ✅ All 5 LLM error scenarios handled (rate limit, timeout, overloaded, offline, policy)
- ✅ Permission errors clear ("can see but can't write")
- ✅ Keyboard nav: Tab, Enter, Cmd+K, Escape all work
- ✅ Screen reader: messages announced, widget labeled
- ✅ Mobile: touch 44px+, virtual keyboard doesn't push chat off
- ✅ Dark mode: theme auto-applies, readable
- ✅ MCP read tools callable (get_trip_summary at minimum)
- ✅ README complete
- ✅ Manual tests passed (chat flow, errors, UI, accessibility)

### Phase 4 (Optional)
- ✅ Write operations confirmed (create_todo, create_packing_item, etc.)
- ✅ Suggestions trigger per spec
- ✅ Virtualization reduces memory (<50MB on 1000+ message convos)
- ✅ Monitoring dashboard shows metrics
- ✅ Security audit: no API keys in logs, rate limiting enforced

---

## Timeline Summary

| Week | Phase | Deliverable |
|------|-------|-------------|
| 1-2 | P1 | Plugin skeleton, LLM client, basic chat UI, message flow |
| 2-3 | P2 | MCP integration, trip context, chat persistence, model discovery |
| 3 | P3 | Streaming, error handling, accessibility, **go-live ready** |
| 4 | P4 | Write ops, proactive features, optimization (optional) |

**Ship date:** End of week 3 (Phase 3 complete)
**Enhancement phase:** Week 4 if desired for production hardening
