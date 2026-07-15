# AI Chatbot Plugin — Project State

**Status:** Planning complete. Ready for Phase 1 execution.
**Last updated:** 2026-07-15
**Timeline:** Production MVP week 3 (3-4 weeks total)

---

## Project Context

**Vision:** Comprehensive AI chatbot plugin for Trek. Conversational assistant that leverages Trek's LLM configuration, MCP server, and plugin system to help users plan trips, explore data, and get real-time travel assistance.

**Scope:** Full-featured MVP (chat + read/write + suggestions + all LLM providers + MCP integration). Dual UI (widget + modal), trip-level persistence, streaming responses.

**Key Decisions:**
1. **LLM Providers:** Support all three (local, OpenAI, Anthropic) + OpenAI-compatible (llama.cpp, vllm) with dynamic model discovery
2. **Config Model:** Hybrid — default to AI Parsing addon, user can override
3. **Architecture:** Trek plugin (forked child process, RPC via ctx), leverages existing plugin sandbox/permissions
4. **Data Access:** MCP tools (not direct DB), respecting user-configured scopes
5. **Persistence:** Trip-level metadata storage (ctx.meta), not ephemeral
6. **UI Location:** Trip-page plugin type (tab in trip planner) + standalone page
7. **Timeline:** 3-4 weeks for production-ready MVP

---

## Key Requirements

### Core Features
- F1: Dual-interface chat (widget footer + modal sidebar)
- F2: Multi-provider LLM with model discovery
- F3: MCP-based trip data access with permission enforcement
- F4: Multi-turn conversations with context awareness
- F5: Streaming responses, error handling, retry logic
- F6: Trip-level chat history persistence
- F7: User-configurable LLM provider + MCP tool permissions
- F8: Trek design system integration, WCAG 2.1 AA accessibility

### Technical Constraints
- C1: Must follow Trek plugin architecture (forked child, RPC, sandbox isolation)
- C2: MCP addon required, scopes bind to user OAuth token
- C3: Reuse AI Parsing addon's LLM config resolver (single source of truth)
- C4: Trip data via MCP tools (not direct DB access)
- C5: Broadcast trip updates via ctx.ws, subscribe to core events
- C6: Plugin metadata storage (ctx.meta), not child process memory

---

## Architecture Overview

```
User Browser (Sandboxed iframe)
    ↓
Trek Plugin Widget/Modal (client/index.html)
    ↓ postMessage bridge (trek:invoke)
    ↓
Trek Plugin Server (server/index.js)
    ↓ RPC via ctx (permission-checked)
    ├→ LLM Client (local/OpenAI/Anthropic)
    ├→ MCP Tools (via Trek MCP addon)
    ├→ Trip Metadata (ctx.meta storage)
    └→ WebSocket Broadcast (ctx.ws)
    ↓
Trek Host (RPC, MCP, DB, permissions)
```

### Key Components
1. **LLM Client:** Abstract client supporting OpenAI-compatible + Anthropic
2. **Chat Handler:** `/chat` route receives message, calls LLM, streams response
3. **MCP Integration:** Call MCP tools for trip data (read + write)
4. **Widget UI:** Footer button + modal sidebar, Trek design tokens
5. **Persistence:** Store messages in trip metadata (ctx.meta.set/get)
6. **Config:** Instance-wide LLM settings + per-trip MCP scope overrides

---

## Research Summary

### 1. Chat UI/UX Patterns (Agent 3)
- Widget UI: footer button with badge, hover preview, slide-up animation
- Modal UI: right sidebar (desktop) / full-screen (mobile)
- Streaming: token-by-token display, cursor indicator, stop button
- Errors: toast notifications with retry logic
- Suggestions: collapsible cards, dismissible
- **Output:** .planning/research/CHAT_UI_PATTERNS.md

### 2. Trek Plugin Architecture (Agent 2)
- Isolated child process, RPC communication, permission-checked calls
- Plugin types: widget, page, trip-page, integration
- MCP integration: tools available, scope enforcement, permission model
- Trip data access: ctx.trips.*, ctx.places.*, ctx.days.*, ctx.meta.*
- Hooks & events: provider hooks, event subscriptions, plugin-to-plugin calls
- **Output:** .planning/research/TREK_PLUGIN_PATTERNS.md

### 3. LLM Chatbot Patterns (Agent 1)
- Launched deep-research skill (WebSearch + verification)
- Researching: conversation management, multi-provider patterns, model discovery, context handling, error scenarios
- **Status:** In progress (parallel research ongoing)

---

## Planning Documents

| File | Content | Status |
|------|---------|--------|
| `.planning/PROJECT.md` | Vision, scope, decisions, constraints | ✅ Complete |
| `.planning/REQUIREMENTS.md` | 8 feature areas, NF requirements, constraints, references | ✅ Complete |
| `.planning/ROADMAP.md` | 4 phases, 3-4 weeks, deliverables, risk mitigation | ✅ Complete |
| `.planning/research/TREK_PLUGIN_PATTERNS.md` | Plugin architecture, MCP integration, patterns | ✅ Complete |
| `.planning/research/CHAT_UI_PATTERNS.md` | UI/UX patterns, streaming, error handling, design tokens | ✅ Complete |
| `.planning/research/LLM_PATTERNS.md` | LLM best practices (awaiting deep-research completion) | 🔄 In progress |
| `.planning/config.json` | Workflow preferences (research-first, thorough) | ✅ Complete |
| `.planning/STATE.md` | This file — project memory | ✅ Complete |

**Codebase docs:** `.planning/codebase/` (7 docs, 1827 lines, committed df321c8e)

---

## Execution Timeline

### Week 1-2: Phase 1 (Architecture & Skeleton)
- P1.A: Project scaffolding, manifest, directory structure
- P1.B: LLM client (OpenAI-compatible + Anthropic)
- P1.C: Chat UI (widget button + modal, message list, input)
- Deliverable: Single round-trip message flow working end-to-end

### Week 2-3: Phase 2 (MCP & Persistence)
- P2.A: Trip context loading, MCP tool integration, permission config
- P2.B: Chat history storage (metadata), clear history
- P2.C: System prompt + context injection
- P2.D: Model discovery + selector
- Deliverable: Chatbot querying trip data, persisting history

### Week 3: Phase 3 (Polish & Go-Live)
- P3.A: Streaming responses
- P3.B: Error handling (5 scenarios)
- P3.C: Keyboard nav + ARIA + mobile optimization
- P3.D: MCP read-only tools
- P3.E: Testing + documentation
- Deliverable: **Production-ready MVP**

### Week 4: Phase 4 (Optional Enhancement)
- P4.A: Write operations (create todo, packing, budget, place)
- P4.B: Proactive suggestions
- P4.C: Performance tuning (virtualization, caching)
- P4.D: Monitoring + metrics
- P4.E: Security hardening

---

## Known Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| LLM config hybrid mode (default to addon, override) | High | P1: Unit test both paths, integration test with real addon config |
| MCP tool calling implementation | High | P2: Start with mock tools, switch to real incrementally |
| Context window truncation too aggressive | Medium | P2: Log truncation events, test with 100+ message convos |
| Streaming memory leak | Medium | P3: Test 10min+ streams, backpressure handling |
| Mobile UX (virtual keyboard, touch targets) | Low | P3: Lighthouse audit, manual iOS/Android testing |
| API key leakage in logs | Critical | P1: Grep patterns, encryption library tests, audit logging |

---

## Blockers & Dependencies

**None identified.** All dependencies are satisfied:
- Trek plugin SDK available
- AI Parsing addon (llm-parse) patterns documented
- MCP addon available
- Trek design system tokens accessible
- codebase mapped and documented

---

## Next Steps

**Immediate:**
1. Run `/gsd-plan-phase 1` to create detailed task plan for Phase 1
2. Review Phase 1 plan, confirm scope
3. Begin Phase 1 execution (scaffolding, LLM client, basic chat UI)

**Before shipping:**
- Manual testing: chat flow, LLM errors, permissions, UI responsive
- Accessibility: keyboard nav, screen reader, color contrast
- Performance: latency <500ms context, <100ms first token
- Security: no API key leakage, permission enforcement verified

**After shipping:**
- Monitor error logs, latency metrics, user feedback
- Plan Phase 4 enhancements if Phase 3 needs hardening

---

## Team Notes

**Project:** AI Chatbot Plugin for Trek
**Owner:** masao.jeffery@gmail.com
**Decision style:** Thorough, research-first
**Timeline:** Production MVP week 3 (3-4 weeks)
**Scope:** Full-featured (all LLM providers, read/write, suggestions, dual UI)

**Key assumptions:**
- Trek plugin SDK mature + documented (✅ verified in wiki)
- AI Parsing addon config resolver reusable (✅ llm-config.ts examined)
- MCP addon provides all needed tools (✅ MCP-Addon-Tools.md comprehensive)
- Trek design tokens accessible in widget iframe (✅ trek:ui marker + window.trek bridge)
- Plugin metadata storage sufficient for chat history (✅ 64KB value limit per message adequate)

**Success criteria:** Phase 3 deliverables achieved, manual tests passed, accessibility verified, performance benchmarks met.
