# AI Chatbot Plugin — Requirements

## Overview

Comprehensive conversational AI assistant for Trek trips. Runs as a Trek plugin (isolated process, RPC architecture) and accesses trip data via Trek's MCP server respecting user-configured permissions. Supports local LLM providers (Ollama, llama.cpp, vllm) and cloud APIs (OpenAI, Anthropic) with dynamic model discovery.

**Scope:** Full-featured MVP in 3-4 weeks. Dual UI (widget + modal), read/write trip data, proactive suggestions, chat persistence.

---

## Feature Requirements

### F1: Conversational Chat Interface

**F1.1 Dual-Interface UI**
- Widget UI: 64px circular button (footer), unread badge, quick preview on hover
- Modal/Sidebar UI: Right sidebar on desktop (380-420px), full-screen modal on tablet/mobile
- Both interfaces share state (opening widget → same chat history as modal)
- Widget minimizes to button without losing state
- **Reference:** [[Plugin-Development#the-design-kit-recommended]]

**F1.2 Message Display & History**
- User messages right-aligned, primary color; bot messages left-aligned, surface-secondary
- Infinite scroll upward to load older messages (pagination 25-50 msgs per load)
- Sticky trip context card at top (collapsible): trip name, dates, members, budget/packing/todos progress
- Timestamps on hover (desktop) / always visible (mobile)
- Persistent history storage (stored with trip, not ephemeral)

**F1.3 Streaming Response Display**
- Token-by-token rendering (start on first chunk, ~50-100ms latency)
- Cursor indicator (blinking) while streaming
- "Stop generating" button (cancels LLM call in progress)
- Partial messages kept if user cancels mid-stream

**F1.4 Input Area**
- Text input with auto-expanding textarea (max 100px)
- Send button on Enter or explicit click
- Draft text persists across minimize/maximize
- Accessible keyboard shortcuts (e.g., Cmd+K to toggle widget)

### F2: LLM Provider Integration

**F2.1 Multi-Provider Support**
- Default to AI Parsing addon config (hybrid mode: defaults to AI Parsing, allow override)
- Supported providers: local (Ollama/llama.cpp/vllm), OpenAI, Anthropic, plus any OpenAI-compatible API
- OpenAI-compatible baseUrl parameter (e.g., local Ollama at http://localhost:11434/v1)
- **Reference:** [[../server/src/nest/llm-parse/clients/openai-compatible.client.ts]], [[../server/src/nest/llm-parse/llm-config.resolver.ts]]

**F2.2 Model Discovery**
- Query local LLM endpoints for available models at /api/tags (Ollama) or equivalent
- Display list of available models in plugin settings
- Allow user to select from discovered models (don't hardcode model names)
- Fall back to configured model if discovery fails

**F2.3 API Key Management**
- For cloud providers: accept API key in plugin settings (store encrypted)
- For local: no key required (assumed running locally)
- Hybrid config: user can override AI Parsing addon settings per plugin instance if needed
- Mask API keys in admin UI (display as ••••••••)
- **Reference:** [[../server/src/services/llmConfig.ts]]

**F2.4 Conversation Management**
- Maintain conversation history with context window management
- Truncate older messages or summarize when context limit approaches
- Temperature: 0.7 default (conversational), override per request if needed
- Timeout: 300s for local models (CPU cold-load), 30s for cloud APIs
- Max tokens: 2048 per response (user-configurable)

### F3: Trip Data Access & MCP Integration

**F3.1 Smart Context Selection**
- Chatbot requests trip data via MCP tools (not full-context injection)
- Can query: trips, places, days, assignments, reservations, budget, packing, todos, tags, collab notes
- Chatbot decides what to fetch based on conversation context
- **Reference:** [[MCP-Addon-Tools.md]], [[Plugin-Cookbook.md#read-a-trips-places-and-bookings]]

**F3.2 Permission Enforcement**
- Respect user-configured MCP scopes (e.g., can read trips but not write)
- Configuration UI: let user select which MCP tools chatbot can access
- Chatbot cannot bypass user's MCP permissions — only callable tools are available
- Display permission limitations in chat: "I can see your packing list but don't have permission to add items."
- **Reference:** [[MCP-Scopes.md]], [[Plugin-Permissions.md]]

**F3.3 Read Operations**
- `GET /trips` — list user's trips
- `GET /trip/{id}` — retrieve full trip context (summary for context card)
- `GET /places` — search/list places in trip
- `GET /reservations` — list bookings
- `GET /packing` — list packing items + bags
- `GET /todos` — list trip todos
- `GET /budget` — budget summary + items
- All reads membership-checked by host

**F3.4 Write Operations** (if permission granted)
- `POST /place` — create new place (name, location, notes)
- `POST /todo` — create todo item
- `POST /packing-item` — add to packing list
- `POST /budget-item` — add budget entry
- `POST /reservation` — create booking record (flight, hotel, restaurant)
- `POST /day-note` — add day note
- All writes require trip access + entity edit permission
- **Reference:** [[Plugin-Cookbook.md#add--move-something-on-the-itinerary]]

### F4: Conversation Features

**F4.1 Greeting & Context Setup**
- Bot initiates: "Hi! I'm your trip assistant. What trip are you working on?"
- One-turn context setup (user names trip → bot loads, don't repeat)
- Trip summary card pinned at top after context set
- Quick-action pills for common queries: "Plan activities" | "Budget summary" | "Packing tips"

**F4.2 Use Cases (All Supported)**
- **Trip Planning:** Suggest activities, answer destination questions, help plan itinerary
- **Travel Companion:** Real-time recommendations, booking assistance, problem-solving
- **Data Exploration:** Query reservations, itinerary, budget, packing status
- **General Q&A:** Answer questions by synthesizing trip context

**F4.3 Multi-Turn Conversations**
- Handle follow-up questions with conversation history
- Context-aware responses (mention relevant budget, date, weather)
- Clarification strategy: ask once with pill buttons if ambiguous (3-4 pills max)
- Prune old turns after 50+ messages (keep recent, archive rest)

**F4.4 Proactive Suggestions**
- Trigger patterns:
  - Trip just created → "Want me to help plan your itinerary?"
  - User mentions weather → "I can suggest packing for 28°C weather"
  - Budget >85% spent → "Your budget is getting tight"
  - Packing 0% + 2 days before trip → "Your packing list is empty"
- Render as collapsible cards below bot message (not intrusive)
- User can dismiss individual suggestions
- Confidence signaling: "Likely...", "Possibly...", "I'm not sure but..."

**F4.5 Actionable Responses**
- Structured cards for complex actions:
  - **Add to packing:** "Suggested items: [Sunscreen +] [Rain jacket +]"
  - **Create reservation:** Rich card with "Add to trip" button
  - **Budget:** "Current: $8,940 (71%) | Remaining: $3,660 [View] [Adjust]"
- Non-destructive actions: instant execution + undo toast
- Destructive actions: require confirmation modal

### F5: Error Handling & UX

**F5.1 LLM Failures**
| Error | UX | Action |
|-------|----|----|
| Rate limit | "You've sent many. Wait a moment." (auto-retry 30s) | Retry button |
| Token limit | "Message too long. Try shorter question." | Clear history button |
| Model overloaded | "Assistant is busy. Retrying..." | Cancel button |
| Provider down | "Can't connect to LLM. Retry?" | Retry button |

**F5.2 Permission Denials**
- Missing MCP scope: "I can't see X because permission not configured. [Authorize]"
- No trip access: "You don't have access to Trip X. Ask owner to add you."
- Permission error in response: Display as info banner (not modal)

**F5.3 Data Loading Errors**
- Trip not found: Fuzzy-match suggestions ("Did you mean: Tokyo | Bali | Bangkok?")
- Stale data: "Last synced 2 hours ago. [Refresh]" button
- Network timeout: Exponential retry with toast updates (2s → 5s → 10s)

**F5.4 Toast & Notification Patterns**
- Success: Slide in from bottom, auto-dismiss 3s (e.g., "Added to packing ✓")
- Error: Slide in, persist until dismissed (e.g., "Connection lost [Retry]")
- Loading: Skeleton or spinner (don't block input)

### F6: Chat Persistence & State

**F6.1 Trip-Level Storage**
- Store all messages as trip metadata via `ctx.meta` (plugin-scoped)
- Conversation history persists across sessions
- Clear history button (with confirmation modal)
- Archive old conversations after 90 days (optional, configurable)
- **Reference:** [[Plugin-Cookbook.md#tag-a-core-entity---no-schema-fork]]

**F6.2 Plugin State Management**
- Use `ctx.meta` for plugin-scoped key/value storage (not child process memory)
- Store: conversation ID, last message timestamp, user preferences, trip context cache
- Ephemeral state (in-flight requests) stored in child process, OK to lose on crash
- **Reference:** [[TREK_PLUGIN_PATTERNS.md#key-trek-conventions-for-chatbot-plugin]]

### F7: Configuration & Settings

**F7.1 Plugin-Level Configuration** (instance-wide)
- LLM provider choice (default from AI Parsing addon)
- Model override (if user wants different model than addon uses)
- Max tokens per response (default 2048)
- Enable/disable proactive suggestions (default on)
- Archive message age threshold (default 90 days)
- Enable MCP tool access (list of MCP tools user permits)

**F7.2 User Overrides**
- Hybrid model: defaults to AI Parsing addon config, allow per-plugin override
- UI for selecting MCP tool permissions (checkboxes or scope picker)
- Chatbot discovery endpoint for listing available models
- **Reference:** [[Plugin-Permissions.md#declaring-them]], [[TREK_PLUGIN_PATTERNS.md#plugin-settings--configuration]]

**F7.3 Secret Handling**
- API keys encrypted at rest (reuse `apiKeyCrypto` pattern from llm-parse addon)
- Masked in admin UI as ••••••••
- Never logged or exposed in error messages
- **Reference:** [[../server/src/services/llmConfig.ts#decryptLlmApiKey]]

### F8: Design & Accessibility

**F8.1 Trek Design System Integration**
- Use Trek's color tokens: user messages `bg-primary-500`, bot messages `bg-surface-card`
- Typography: `text-body` for messages, `text-caption` for timestamps
- Corner radius: 12px for messages, 20px for input (pill style)
- Spacing: 12px message padding, 8px gap between messages
- Dark mode: all tokens auto-support (CSS variables)
- **Reference:** [[CHAT_UI_PATTERNS.md#trek-design-system-integration]]

**F8.2 Accessibility (WCAG 2.1 AA)**
- Widget button: tab-focusable, ARIA labels for unread count
- Keyboard shortcuts: Cmd+K to toggle widget, Ctrl+Enter to send (customizable)
- Screen reader: ARIA live regions for incoming messages, typing indicator
- Touch targets: min 44px height on buttons
- Color contrast: 4.5:1 for text, 3:1 for UI elements

**F8.3 Responsive Design**
- Desktop: sidebar 380-420px fixed width
- Tablet: modal 90vw, drag-to-dismiss from top
- Mobile: full-screen view, back gesture to dismiss
- Virtual keyboard: doesn't push chat off-screen

---

## Non-Functional Requirements

### NF1: Performance

- **First message latency:** <500ms (context setup)
- **Response streaming latency:** <100ms first token (for cloud), <2s for local CPU models
- **Widget open animation:** 200ms (smooth, no jank)
- **Message pagination:** load 25-50 msgs per scroll (no full-history load)
- **MCP call timeout:** 15s (read), 30s (write)
- **Message history DB query:** <200ms (indexed on trip_id)

### NF2: Reliability

- Plugin crash recovery: auto-restart with exponential backoff (5 crashes in 5min → mark error)
- Timeout handling: graceful degradation (partial message kept if LLM timeout)
- Network failure retry: exponential backoff 2s → 5s → 10s (max 3 retries)
- Data consistency: MCP calls use host's transaction model (respect atomicity)
- No silent failures: always inform user if something went wrong

### NF3: Security

- **RPC isolation:** Plugin cannot forge host messages or access raw process IPC
- **Permission enforcement:** Ungranted MCP calls refused by host, not plugin
- **API key encryption:** at-rest encryption + masked in logs + never in error messages
- **SSRF protection:** local endpoint disallowed (prevent exfil via loopback)
- **Sandbox escaping:** no native binaries, no worker threads, no process spawning
- **CSP enforcement:** plugin iframe `connect-src` restricted to declared egress hosts
- **Audit logging:** all DB writes from plugin logged with user + timestamp

### NF4: Scalability

- **Message storage:** store in plugin metadata (ctx.meta), 64KB value limit per message
- **Conversation archiving:** prune after 90 days (prevent unbounded growth)
- **Concurrency:** handle 10+ concurrent chat requests per user (via RPC queueing)
- **MCP tool calls:** max 15s timeout, queue if multiple pending
- **Memory:** child process footprint <100MB (crash if exceeds)

---

## Technical Constraints

### C1: Trek Plugin System
- Must follow [[Plugin-Development.md]] architecture (forked child process, RPC via ctx)
- Declare all permissions in manifest (cannot dynamically request)
- Routes auth-guarded: every handler requires `auth: true` or user membership check
- Widget UI in sandboxed iframe (opaque origin, no session cookie)
- **Reference:** [[TREK_PLUGIN_PATTERNS.md#plugin-isolation--rpc-communication]]

### C2: MCP Integration
- MCP addon must be enabled for chatbot to function (declare `requiredAddons: ["mcp"]`)
- Tool calls inherit user context (no escalation)
- Scopes bound to user's OAuth token (cannot grant more than user has)
- Only callable tools are accessible (no reflection/enumeration of all tools)
- **Reference:** [[MCP-Addon-Tools.md]], [[MCP-Scopes.md]]

### C3: LLM Configuration
- Reuse AI Parsing addon's LLM config resolver (single source of truth)
- Support OpenAI-compatible chat/completions endpoint (baseUrl parameter)
- No provider-specific URL parameters (Ollama uses same /v1 path as others)
- Temperature pinned to 0.7 (conversational), tunable per request
- **Reference:** [[../server/src/nest/llm-parse/llm-config.resolver.ts]], [[../server/src/nest/llm-parse/clients/openai-compatible.client.ts]]

### C4: Data Access
- Read trips via `ctx.trips.*` (membership-checked by host)
- Write via MCP tools (not direct DB access)
- Plugin metadata via `ctx.meta` (namespaced per plugin)
- Cannot bypass host's permission model
- Jobs/hooks: no user context (cannot read trip data)
- **Reference:** [[Plugin-Cookbook.md]], [[TREK_PLUGIN_PATTERNS.md#trip-data-access-patterns]]

### C5: Communication Model
- Broadcast trip updates via `ctx.ws.broadcastToTrip` (for real-time collab)
- Event subscriptions: declare in manifest, handler runs with no user context
- Plugin-to-plugin calls: only via declared dependencies + exported functions
- No raw IPC or process.send (RPC channel sealed in SDK)
- **Reference:** [[Plugin-Cookbook.md#push-a-live-update-to-a-trip--a-user]]

### C6: State & Persistence
- Plugin data in separate SQLite file (via `ctx.db.own` if needed)
- Conversation history in trip metadata (ctx.meta)
- No process-memory persistence (lost on crash/restart)
- Configuration stored instance-wide in plugin.config (read-only at runtime)
- **Reference:** [[TREK_PLUGIN_PATTERNS.md#state-management]]

---

## Out of Scope

- Mobile app integration (web widget/modal only; assume web-first)
- Multi-turn conversation summarization (keep full history in trip metadata)
- Voice/audio input (text-only for MVP)
- Plugin-to-plugin dependencies (standalone, no cross-plugin calls)
- Conversation export or analytics
- Rate limiting per user (rely on LLM provider's rate limits)
- Custom system prompts per trip (single system prompt for all trips)
- Integration with Trek's AI Parsing addon's extraction results (parallel system, not dependent)

---

## Success Criteria

- [ ] Chatbot functional across all three LLM providers (local, OpenAI, Anthropic)
- [ ] Dual UI (widget + modal) operational on desktop/tablet/mobile
- [ ] Chat history persisted with trip via metadata
- [ ] MCP tools callable with permission enforcement working
- [ ] Streaming responses display token-by-token
- [ ] Proactive suggestions trigger per spec (trip created, budget alert, etc.)
- [ ] Error handling & UX per spec (toast, retry, permission messages)
- [ ] Configuration UI for LLM provider + MCP tool selection
- [ ] Model discovery working (list available models from local endpoint)
- [ ] Trek design system tokens applied (colors, typography, spacing)
- [ ] Accessibility: WCAG 2.1 AA (keyboard nav, ARIA, contrast)
- [ ] Performance: <500ms context setup, <100ms first token streaming
- [ ] Security: no API key leakage, permission enforcement verified, SSRF guarded

---

## References

- [[Plugin-Development.md]] — Full SDK and architecture guide
- [[Plugin-Cookbook.md]] — Copy-paste recipes for common patterns
- [[Plugin-Permissions.md]] — Detailed permission reference
- [[Plugins.md]] — Admin workflow and plugin types
- [[MCP-Addon-Tools.md]] — MCP tool reference
- [[MCP-Scopes.md]] — MCP permission scopes
- [[TREK_PLUGIN_PATTERNS.md]] — Codebase-specific patterns (local)
- [[CHAT_UI_PATTERNS.md]] — UI/UX patterns and component design (local)
