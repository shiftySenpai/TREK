# AI Chatbot Plugin for Trek

## Vision
Comprehensive AI chatbot plugin that integrates with Trek's trip planning and travel companion workflows. Leverages existing AI Parsing addon configuration while providing conversational, bidirectional access to trip data across all use cases.

## Use Cases (All Supported)
- **Trip Planning Assistant** — Help users plan trips, answer destination questions, suggest activities
- **Travel Companion** — Real-time assistance during trip with recommendations, bookings, problem-solving
- **Trip Data Explorer** — Query and analyze reservations, itinerary, budget, packing
- **General Trip Q&A** — Answer questions by analyzing full trip context

## Key Constraints & Decisions

### LLM Providers
- **Primary targets:** Local (Ollama), OpenAI, Anthropic
- **Extended support:** llama.cpp, vllm, any OpenAI-compatible API endpoint
- **Discovery:** Ability to query providers for available models
- **Config:** Hybrid model — defaults to AI Parsing addon settings with user override capability

### Data Access & Permissions
- Chatbot respects Trek MCP server permissions
- Users configure which MCP tools chatbot can access
- Smart context selection — chatbot requests data via MCP tools as needed (not full-context injection)

### UI/UX
- **Dual interface:** Quick-access widget on trip page + full-featured modal
- **Context:** Smart selection — chatbot determines what data to fetch via MCP queries
- **Persistence:** Trip-level chat history storage (part of trip data)

### Scope & Timeline
- **MVP Scope:** Full-featured (chat + read/write + suggestions + integrations)
- **Timeline:** Production-ready in 3–4 weeks
- **Decision style:** Thorough with upfront planning and validated design

## Success Criteria
- [ ] Chatbot functional across all three LLM providers
- [ ] Conversational interface accessible via widget + modal
- [ ] Read/write trip data respecting MCP permissions
- [ ] Chat history persisted with trip
- [ ] Suggestions proactive based on trip context
- [ ] Works with OpenAI-compatible endpoints (discovery-enabled)
- [ ] Production-quality UX and error handling

## Technical Dependencies
- Trek plugin system (RPC architecture, sandboxed iframe)
- Trek MCP server (resources, tools, permissions)
- AI Parsing addon (LLM provider config, encryption, resolution logic)
- Trek shared types (KiReservation, trip schemas, Zod validation)

## Next Steps
1. Domain research (AI chatbot patterns, plugin integration best practices)
2. Requirements definition (detailed feature specs)
3. Roadmap creation (phase breakdown)
4. Phase 1 execution (architecture, skeleton, MVP features)
