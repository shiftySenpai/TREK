# Phase 1 Implementation Research: AI Chatbot Plugin

## Context
Trek's AI Chatbot plugin spans 4 phases. Phase 1 delivers core architecture + basic chat: plugin scaffolding, LLM integration, widget/modal UI, single round-trip message flow. This research examines the Trek codebase (plugin SDK, llm-parse addon, existing plugins) to distill implementation patterns and risks.

---

## 1. PLUGIN SCAFFOLDING PATTERN

### Trek-Plugin CLI Workflow
Trek plugins scaffold via `npx trek-plugin-sdk create ai-chatbot --type trip-page`. This generates:
- `trek-plugin.json` manifest (id, version, apiVersion: 1, permissions, requiredAddons)
- `server/index.js` entry (exports definePlugin({ routes, hooks, onLoad, onUnload }))
- `client/index.html` entry (single HTML file with `<!-- trek:ui -->` marker)
- `package.json` with trek-plugin-sdk as devDependency only (injected at runtime)

### Manifest Structure for Chat Plugin
```json
{
  "id": "ai-chatbot",
  "name": "AI Assistant",
  "version": "0.1.0",
  "apiVersion": 1,
  "type": "trip-page",
  "icon": "MessageCircle",
  "permissions": [
    "db:read:trips",
    "db:read:places",
    "db:read:packing",
    "db:read:costs",
    "db:meta",
    "http:outbound",
    "ws:broadcast:trip"
  ],
  "requiredAddons": ["mcp"],
  "egress": ["api.openai.com", "api.anthropic.com"],
  "routes": [
    { "method": "POST", "path": "/chat", "auth": true },
    { "method": "GET", "path": "/models", "auth": true },
    { "method": "GET", "path": "/config", "auth": true }
  ]
}
```

### Key Design Decisions
- **Type: trip-page** — Plugin tab inside trip planner (not standalone page). Receives tripId in ctx automatically.
- **Permissions:** Read-only in Phase 1 (db:read:trips, db:meta for storage). Write permissions (db:write:*) in Phase 4.
- **Required Addon: mcp** — Plugin won't activate without MCP addon. Enables Phase 2 tool integration without rework. Phase 1 doesn't use MCP yet, but declaring it upfront avoids activation hassles.
- **Egress allowlist:** OpenAI + Anthropic + localhost (for local Ollama). Host enforces CSP on iframe; undeclared domains blocked.

### Plugin Lifecycle
1. Admin activates plugin in settings
2. Host forks child process, loads `server/index.js`, calls `onLoad(ctx)`
3. Plugin reports routes to host; host mounts them at `/api/plugins/ai-chatbot/<path>`
4. Client iframe loads at `/plugin-frame/ai-chatbot/ui/index.html` (opaque origin, sandboxed)
5. Client calls `trek.invoke('/chat')` → proxied to `/api/plugins/ai-chatbot/chat` (user context passed)
6. Plugin child processes request, calls LLM, returns response

### Local Dev Workflow
```bash
npx trek-plugin-sdk create ai-chatbot --type trip-page
cd ai-chatbot
npx trek-plugin-sdk dev  # http://localhost:4317
```

Dev server provides:
- Dashboard listing routes + UI preview
- `/api/<path>` serves route handlers
- `/ui` shows client HTML in sandboxed frame
- `/preview` theme toggle (real sandboxed iframe testing)
- Permission enforcement (ungranted call → PERMISSION_DENIED, caught early)
- Hot reload on file change

---

## 2. LLM CLIENT ARCHITECTURE

### Reuse vs. Build Decision: EXTEND from llm-parse Addon Patterns

Trek's llm-parse addon (`server/src/nest/llm-parse/`) provides production-grade LLM integration:
- **llm-config.resolver.ts:** Hybrid config resolution (instance-wide addon config wins, falls back to per-user settings, falls back to defaults)
- **llm-client.factory.ts:** Factory that instantiates provider-specific clients
- **clients/openai-compatible.client.ts:** Handles OpenAI + Ollama + any OpenAI-compatible endpoint
- **clients/anthropic.client.ts:** Anthropic Messages API with tool-use for structured output
- **llmConfig.ts:** Encryption/decryption, config types, masking for admin UI

### Chatbot Plugin LLM Client Pattern

Create lightweight `server/llm-client.js` that:
1. Uses simple fetch (no SDK dependencies)
2. Supports OpenAI-compatible endpoints (covers cloud OpenAI, local Ollama, vLLM, llama.cpp)
3. Supports Anthropic API (distinct headers, tool-use for structured output)
4. Implements simple `chat(messages, options)` interface (not extraction)
5. Handles provider-specific timeouts (30s cloud, 300s local CPU cold-load)

### Config Resolution: Hybrid Mode Design
Phase 1: Simple fallback chain
1. Try override params in request (model, provider)
2. Fall back to `ctx.config` (admin-set, stored encrypted)
3. Fall back to hardcoded defaults (model: 'llama2', provider: 'local', baseUrl: 'http://localhost:11434/v1')

Phase 2: Extend to addon integration
1. Query addon config resolver via RPC pattern (plugin cannot directly import addon)
2. Override if user/trip has per-instance preference
3. Persist overrides in trip metadata

### API Key Security Pattern
- Reuse llm-parse addon's `apiKeyCrypto` pattern: encrypt at rest, decrypt only server-side
- Admin configures via settings UI; host encrypts and stores in plugin config
- Never log raw keys; mask in responses and error messages (`••••••••`)
- Plugin routes strip API key from error details before returning to client

### Example LLM Client (sketch)
```js
class ChatLlmClient {
  constructor(config) {
    this.config = config; // { provider, model, baseUrl, apiKey }
  }
  
  async chat(messages, options = {}) {
    const { temperature = 0.7, maxTokens = 2048 } = options;
    
    if (this.config.provider === 'anthropic') {
      return this.chatAnthropic(messages, { temperature, maxTokens });
    }
    // OpenAI-compatible (includes local)
    return this.chatOpenAiCompatible(messages, { temperature, maxTokens });
  }
  
  async chatOpenAiCompatible(messages, { temperature, maxTokens }) {
    const base = (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = `${base}/chat/completions`;
    
    const body = {
      model: this.config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
    
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM error (${res.status}): ${detail.slice(0, 200)}`);
    }
    
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
  
  async chatAnthropic(messages, { temperature, maxTokens }) {
    // Similar pattern: base URL, headers, AbortController, timeout
    // Use x-api-key header instead of Authorization
    // Extract content from tool-use response
  }
  
  async getModels() {
    if (this.config.provider === 'local') {
      return await this.queryOllamaModels();
    }
    // Cloud: return hardcoded lists (minimal in Phase 1)
    return {
      openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    }[this.config.provider] ?? [];
  }
}
```

---

## 3. CHAT HANDLER ROUTE PATTERN

### Route Structure (server/index.js)

Server entry exports definePlugin object with:

**POST /chat**
- Input: `{ tripId, message, model?, provider? }`
- Validates tripId, membership check via `ctx.trips.getById(tripId)` (host enforces user access)
- Resolves LLM config (request overrides → ctx.config → defaults)
- Loads conversation history (Phase 1: ctx.db; Phase 2: ctx.meta)
- Builds context: system prompt + recent 10 messages + user message
- Calls LLM, catches errors, stores user + assistant messages
- Returns: `{ userMessageId, assistantMessageId, response }`

Error handling maps common LLM errors to user-friendly messages:
- 429 (rate limit) → "You've sent many. Wait a moment."
- Timeout → "Request timed out. Check connection."
- 401 (auth fail) → "API key invalid. Check settings."
- Overloaded → "Model is busy. Retrying..."

**GET /models?provider=local**
- List available models for selected provider
- Local (Ollama): query `/api/tags`
- Cloud: return hardcoded model lists
- Cache results (TTL 30min) to avoid repeated calls

**GET /config**
- Return current LLM config (mask API key)
- Admin can view/modify settings page

### Conversation History Storage

**Phase 1 Pattern:** Store in plugin's own SQLite (`ctx.db`)
```js
await ctx.db.migrate('001_init', `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    trip_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_trip_created ON messages(trip_id, created_at);
`);
```

Load history: `SELECT ... WHERE trip_id = ? ORDER BY created_at DESC LIMIT 50`

**Rationale:** 
- Plugin's own DB is isolated; no risk of mixing with trip data
- Fast queries via index
- Phase 2 migration: save to trip metadata (`ctx.meta.set('trip', tripId, 'chat_history', [...])`), respecting 64KB limit per metadata value

### Non-Streaming Response (Phase 1)

Simple POST → wait for full response → return JSON

Streaming (Server-Sent Events) deferred to Phase 3.

### Auth & Permission Model
- Every route has `auth: true` → request includes `req.user` (authenticated)
- Host membership-checks `ctx.trips.getById(tripId)` against user
- Plugin never passes user id; host binds it to request
- Ungranted permission (e.g., `db:read:trips` not declared) → PERMISSION_DENIED from host

---

## 4. CHAT UI FRAMEWORK CHOICE

### Recommendation: Vanilla JavaScript (no React) for Phase 1

**Rationale:**
- Trek design kit is CSS-token-driven, not component-library-dependent
- Single HTML file constraint (no bundler in iframe) → React adds 40KB+ overhead
- Koffi example (widget in plugin-sdk/examples/) is pure vanilla + SVG, runs perfectly
- Simpler local dev (no build step; `trek-plugin dev` hot-reloads directly)
- Trivial state management (messages array, waiting flag)

### CSS Approach

Use `<!-- trek:ui -->` marker in `<head>`:
- Dev server expands to inlined design kit CSS + bridge
- Pack command (for release) also inlines
- Provides CSS variables: `--color-primary-500`, `--color-surface-card`, `--color-text-body`, etc.
- Provides utility classes: `.trek-btn`, `.trek-input`, `.trek-chip`, `.trek-card`

**Theme Integration:**
```js
window.trek.onContext((ctx) => {
  console.log(ctx.tokens); // CSS variables available
  console.log(ctx.appearance); // dark/light mode, reduced-motion
});
```

All tokens auto-support dark mode (CSS variables handle it).

### Responsive Layout

**Desktop (trip-page):** Sidebar 380-420px (fixed width, integrated in planner)
**Tablet:** Modal 90vw
**Mobile:** Full-screen, stacked

No media queries needed; flexbox/grid handles it.

### Client Structure (client/index.html - sketch)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Assistant</title>
  <!-- trek:ui -->
  <style>
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: transparent;
    }
    #chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .message {
      padding: 12px;
      border-radius: 12px;
      max-width: 85%;
      word-wrap: break-word;
      line-height: 1.4;
    }
    .message.user {
      align-self: flex-end;
      background: var(--color-primary-500);
      color: white;
    }
    .message.assistant {
      align-self: flex-start;
      background: var(--color-surface-card);
      border: 1px solid var(--color-edge-faint);
      color: var(--color-text-body);
    }
    #input-area {
      padding: 12px;
      border-top: 1px solid var(--color-edge-faint);
      display: flex;
      gap: 8px;
    }
    textarea {
      flex: 1;
      border: 1px solid var(--color-edge-faint);
      border-radius: 20px;
      padding: 10px 14px;
      font-size: 14px;
      resize: none;
      max-height: 100px;
      font-family: inherit;
      background: var(--color-surface-primary);
      color: var(--color-text-body);
    }
    button {
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div id="chat-container">
    <div id="messages"></div>
    <div id="input-area">
      <textarea id="message-input" placeholder="Ask me anything..." rows="1"></textarea>
      <button id="send-btn" class="trek-btn">Send</button>
    </div>
  </div>

  <script>
    let state = {
      tripId: null,
      messages: [],
      waiting: false,
    };

    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    // Trek bridge: receive trip context
    window.trek.onContext((ctx) => {
      state.tripId = ctx.tripId;
      console.log('Trip ID:', state.tripId);
    });

    // Auto-expand textarea
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
    });

    // Send on Enter (Shift+Enter = newline)
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener('click', sendMessage);

    async function sendMessage() {
      const msg = inputEl.value.trim();
      if (!msg || state.waiting) return;
      
      state.waiting = true;
      inputEl.value = '';
      inputEl.style.height = 'auto';
      inputEl.disabled = true;
      sendBtn.disabled = true;
      
      addMessage('user', msg);
      
      try {
        const response = await window.trek.invoke('/chat', {
          method: 'POST',
          body: JSON.stringify({ tripId: state.tripId, message: msg }),
        });
        
        if (response.error) {
          addMessage('assistant', 'Error: ' + response.error);
        } else if (response.response) {
          addMessage('assistant', response.response);
        }
      } catch (err) {
        addMessage('assistant', 'Error: ' + (err.message || 'Unknown error'));
      } finally {
        state.waiting = false;
        inputEl.disabled = false;
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = `message ${role}`;
      div.textContent = content;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      state.messages.push({ role, content });
    }

    // Signal ready
    window.trek.notify('ready');
  </script>
</body>
</html>
```

### Trek Design Kit Integration
- CSS variables synchronized in real-time (theme changes update immediately)
- `window.trek` bridge methods:
  - `onContext(callback)` — receive trek context (tripId, theme, tokens, appearance)
  - `invoke(path, options?)` — call plugin route (returns Promise)
  - `notify(type, message?)` — show toast (success, error, info)
- All routes called via `trek.invoke()` are authenticated (user context passed by host)

---

## 5. DEV WORKFLOW

### Local Testing Setup

```bash
npx trek-plugin-sdk create ai-chatbot --type trip-page
cd ai-chatbot
npx trek-plugin-sdk dev        # Starts http://localhost:4317
```

Dev server provides:
- **Dashboard** (`/`): Lists all routes, displays server logs
- **Routes preview** (`/api/...`): Hit routes directly (with `?_anon=1` for auth: false)
- **UI preview** (`/ui`): Client HTML in real sandboxed iframe
- **Theme toggle** (`/preview`): Test dark/light mode, reduced-motion, accessibility
- **Hot reload** on file save (client + server both reload)
- **Permission enforcement**: Ungranted permission → PERMISSION_DENIED (test early)

### Fixtures for Testing

Create `dev-fixtures.json` next to manifest:
```json
{
  "trips": {
    "1": {
      "id": 1,
      "members": [42],
      "data": {
        "id": 1,
        "title": "Tokyo 2025",
        "start_date": "2025-03-01",
        "end_date": "2025-03-15",
        "currency": "USD",
        "members": [
          { "id": 42, "username": "alice", "role": "owner" }
        ]
      }
    }
  },
  "users": {
    "42": { "id": 42, "username": "alice", "display_name": "Alice", "avatar": null }
  },
  "config": {
    "provider": "local",
    "model": "llama2",
    "baseUrl": "http://localhost:11434/v1"
  }
}
```

SDK mocks:
- `ctx.trips.getById()` returns fixture trip
- `ctx.db.query()` backed by real SQLite (`.trek-dev/db.sqlite`)
- `ctx.config` returns fixture config
- Membership checks enforced

### Testing Permission Denials

Remove permission from manifest → run dev → ungranted call throws PERMISSION_DENIED. Caught locally before production deployment.

Example: Remove `db:read:trips` from manifest → `ctx.trips.getById()` fails with PERMISSION_DENIED.

### Manual Test Plan

1. **Load UI:** Open `/preview`, verify theme toggle works
2. **Send message:** Type in textarea, click Send
3. **Check route:** POST to `/chat` succeeds (logs LLM call)
4. **Verify storage:** Query `.trek-dev/db.sqlite` messages table
5. **Error case:** Disconnect Ollama → send message → error toast appears
6. **Permission denied:** Remove `db:read:trips` → send message → PERMISSION_DENIED in console

---

## 6. RISK MITIGATION

### Risk 1: LLM Config Resolution Fails (Hybrid Mode Broken)
**Impact:** High — plugin cannot call LLM; goes dead in production

**Mitigation:**
- Phase 1: Test with hardcoded local config in ctx.config (mock admin settings)
- Phase 1: Unit test config fallback chain (request override → ctx.config → defaults)
- Phase 2: Add integration test with addon pattern (once addon config resolver is exposed)
- Keep fallback chain deterministic: no random provider selection

**Verification:**
```js
// Test config resolution
const config = resolveConfig(ctx, 'openai', 'gpt-4');
assert(config.provider === 'openai');
assert(config.model === 'gpt-4');
assert(config.baseUrl === 'https://api.openai.com/v1');
```

### Risk 2: API Key Leakage in Logs
**Impact:** Critical — API key exposure, billing hijack, token exhaustion

**Mitigation:**
- Never log req.body or ctx.config directly
- Mask API key as `••••••••` in all client responses
- Store encrypted: admin UI → host encrypts → ctx.config (read-only at runtime)
- Error messages: strip API key before throwing (use `error.message.slice(0, 200)`)
- Code review: grep for 'apiKey' in logs

**Verification:**
```bash
# Check logs don't leak keys
npx trek-plugin-sdk dev 2>&1 | grep -i "api[_-]?key"  # Should find none
```

### Risk 3: Rate Limiting / Token Limit Errors Not Handled
**Impact:** Medium — user sees raw error, no guidance

**Mitigation Phase 1:**
- Catch fetch errors in llm-client.js
- Map to user-friendly messages: rate limit → "Wait a moment", timeout → "Check connection", overloaded → "Model is busy"
- Response format: `{ error: null, response: "..." }` or `{ error: "Rate limited", response: null }`

**Phase 3 Enhancement:**
- Implement retry logic (exponential backoff)
- Show toast notifications with [Retry] button
- Log retries for monitoring

**Verification:**
```js
// Mock 429 error
const response = await fetch(...);  // Returns 429
// Should catch → return { error: "Rate limited" }
```

### Risk 4: MCP Addon Not Enabled
**Impact:** Medium — Phase 2 blocked; plugin may activate without MCP

**Mitigation:**
- Manifest declares `requiredAddons: ["mcp"]`
- Host refuses activation if addon missing
- Phase 1 doesn't use MCP (safe to not have it)
- Phase 2 depends on this; test MCP pattern early

**Verification:**
- Test plugin activation with/without MCP addon
- Verify error message if addon missing

### Risk 5: Metadata Storage Too Large
**Impact:** Low → Medium — Phase 2 migration issue if not planned

**Mitigation Phase 1:**
- Store in plugin's own SQLite (`ctx.db`), not trip metadata
- Index messages by trip_id for fast queries
- No size limits in Phase 1 (own DB doesn't have 64KB per-value limit)

**Phase 2 Migration Plan:**
- Move to `ctx.meta.set('trip', tripId, 'chat_messages', [...])`
- Trek enforces 64KB per metadata value → pagination (25-50 messages per page)
- Archive old messages after 90 days

**Verification:**
- Phase 2: Estimate message size → ensure < 64KB with 50 messages

### Risk 6: Permission Escalation via MCP (Phase 2 Risk, Plan Now)
**Impact:** High — user can perform actions they shouldn't

**Mitigation:**
- User context inherited from request; host enforces membership + edit permissions
- Plugin cannot grant scopes user doesn't have (host-side enforcement)
- Phase 2: Log all MCP calls (tool, user, result) → audit report

**Verification Phase 2:**
- Test: remove packing:write permission → try to add packing item → fails with PERMISSION_DENIED
- Audit log: review which tools chatbot called on behalf of user

### Risk 7: Streaming Implementation Memory Leak (Phase 3 Risk, Plan Now)
**Impact:** Medium — long streams leak memory, crash plugin

**Mitigation:**
- Phase 3: Use AbortController for timeout + cancellation
- Test with 10+ minute streams, measure memory
- Implement backpressure (pause streaming if buffer too large)
- Monitor: ctx.log error on memory threshold

---

## 7. EXTERNAL DEPENDENCIES

### Phase 1 Dependencies
- **trek-plugin-sdk** (devDependency, injected at runtime) — manifest validation, types, testing kit
- **Node.js crypto** (builtin) — crypto.randomUUID() for message IDs
- **node:sqlite** (optional, for ctx.db.own) — SQLite backed by Node's native sqlite3 module

### No Third-Party npm Packages in Phase 1
Rationale: Simpler bundling, deployment, security review. Reduces surface area.

### Phase 2+ Optional Dependencies
- **uuid** package — if crypto.randomUUID() insufficient
- **form-data** — if multipart uploads needed for files
- **luxon** or **date-fns** — timestamp formatting (low priority)

### Dependency Security Checklist
- Audit npm packages before adding (security advisories)
- Prefer Node builtin modules (crypto, fs, path, url)
- Pin versions in package.json
- Use `npm audit` in CI

---

## 8. CONSTRAINTS & KNOWN GOTCHAS

1. **Single-file client:** `client/index.html` must be self-contained; no external `<script src>` allowed (iframe is sandboxed, opaque origin). Everything must be inlined.
2. **No cookies in iframe:** Trek design kit bridge uses `postMessage` only; session handled by host proxy. `trek.invoke()` includes user context in request.
3. **Permission model:** Declare all permissions in manifest upfront; cannot request dynamically. Ungranted call → PERMISSION_DENIED.
4. **No process spawning:** Cannot fork processes, cannot run native binaries (SSRF-safe design). Use `fetch()` for outbound calls.
5. **Context window awareness:** Track message count; implement pruning after 50+ messages (Phase 2). LLM context limit varies by model.
6. **Relative URLs forbidden:** All outbound calls via `trek.invoke()` (to own routes) or bare `fetch()` (to egress allowlist domains).
7. **Timeout expectations:** Cloud LLM 30s, local CPU 300s. Implement timeouts per provider.
8. **No direct addon imports:** Plugin cannot `require()` addon modules. Route calls through host (Phase 2 pattern TBD).
9. **iframe sandbox constraints:** `allow-scripts allow-forms` only; no `allow-same-origin`. Cannot read parent cookies or DOM.
10. **Hot reload in dev:** Dev server reloads on file save; no persistent state across reloads (design for stateless handlers).

---

## 9. SUCCESS METRICS FOR PHASE 1

Phase 1 is complete when:
- Plugin scaffolds without errors, manifest validates
- Dev server starts (`npx trek-plugin-sdk dev`)
- `/chat` route receives message, calls LLM (mock or real), returns response
- Client: textarea + send button display, message appears on screen (user right, assistant left)
- Config: LLM model/provider can be overridden in ctx.config
- Error handling: LLM timeout/error produces user-friendly message (no raw stack trace)
- Security: No API keys in logs, config masked in admin responses
- Permissions: Ungranted call throws PERMISSION_DENIED during local dev test
- Roundtrip: user message → LLM → assistant response end-to-end works offline (with local Ollama)

---

## 10. FILE STRUCTURE TEMPLATE

```
ai-chatbot/
├── trek-plugin.json           # manifest
├── package.json               # { "devDependencies": { "trek-plugin-sdk": "..." } }
├── README.md                  # overview, setup, screenshots
├── server/
│   ├── index.js               # definePlugin({ routes, onLoad })
│   └── llm-client.js          # LLM client class (OpenAI-compatible + Anthropic)
├── client/
│   └── index.html             # single HTML file with <!-- trek:ui -->
└── .trek-dev/                 # (auto-created by trek-plugin dev)
    └── db.sqlite              # local SQLite for dev testing
```

### server/index.js Structure
```js
const { definePlugin } = require('trek-plugin-sdk');
const ChatLlmClient = require('./llm-client');

module.exports = definePlugin({
  async onLoad(ctx) {
    // Initialize DB schema
  },
  
  routes: [
    {
      method: 'POST',
      path: '/chat',
      auth: true,
      async handler(req, ctx) {
        // Validate → check trip access → load history → call LLM → store messages → return
      },
    },
    {
      method: 'GET',
      path: '/models',
      auth: true,
      async handler(req, ctx) {
        // Query available models for provider
      },
    },
    {
      method: 'GET',
      path: '/config',
      auth: true,
      async handler(req, ctx) {
        // Return current config (mask API key)
      },
    },
  ],
});
```

---

## 11. PHASE 1 → PHASE 2 TRANSITION POINTS

Phase 1 lays groundwork; Phase 2 builds on it:

1. **MCP Integration:** Phase 1 declares addon requirement; Phase 2 adds tool calling
2. **Trip Context:** Phase 1 verifies trip access; Phase 2 displays trip card + context injection
3. **Persistence Migration:** Phase 1 uses ctx.db; Phase 2 moves to ctx.meta (trip-scoped)
4. **Model Discovery:** Phase 1 hardcoded lists; Phase 2 queries addon/local endpoints
5. **Config Resolution:** Phase 1 simple fallback; Phase 2 hybrid (addon → plugin → per-user)
6. **Streaming:** Phase 1 simple POST; Phase 3 switches to SSE (not Phase 2)

Each transition is low-risk due to modular design.

---

## CONCLUSION

Phase 1 delivers minimal, end-to-end chat system:
1. Plugin scaffolds cleanly (trek-plugin CLI, manifest, dev server)
2. LLM client handles OpenAI-compatible + Anthropic (reusing patterns from llm-parse addon)
3. Route handler builds context, calls LLM, stores messages (no MCP yet, no trip context injection)
4. Client (vanilla JS) sends message, displays response (trek.invoke bridge, design kit tokens)
5. Error handling catches + reports failures (user-friendly, no key leaks)
6. Local dev workflow allows offline testing (fixture-based, permission-enforced)

Design is modular: Phase 2 (MCP, trip context), Phase 3 (streaming, polish), Phase 4 (write ops, suggestions) build cleanly atop this foundation without architectural rework.

**Key insight:** The Trek plugin model (RPC isolation, permission enforcement, ctx API) is the main design axis. Leverage it fully from Phase 1; the LLM integration is secondary (mostly fetch + config resolution).
