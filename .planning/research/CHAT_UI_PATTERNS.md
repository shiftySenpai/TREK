# Chat UI/UX & Conversation Flow Patterns

## Chat Interface Design

### Widget UI (Compact, Persistent)
- **Footer button**: 64px circular icon with unread badge + pulse animation
- **Quick preview**: On hover, show last message snippet (1-2 lines) with timestamp
- **Position**: Sticky bottom-right corner (16-20px safe area margin)
- **State transitions**: Closed → glowing dot; opening → slide-up (200ms); expanded → morphs to modal
- **Minimize**: Click icon again or message bubble → collapses without losing state
- **Accessibility**: Tab-focusable, ARIA labels, keyboard shortcut (e.g., Cmd+K)

### Modal/Sidebar UI (Full-Featured, History)
- **Desktop**: Right sidebar (380-420px fixed, matching CollabChat width) — integrated panel, no overlay
- **Tablet**: Full-width modal (90vw) with drag-to-dismiss from top
- **Mobile**: Full-screen view, stacked above main content, back gesture to dismiss

**Header bar:**
- Trip context badge (e.g., "Tokyo 2025 • AI Assistant")
- Typing indicator: "Assistant is thinking..." with pulsing dots
- Clear history button (subtle, bottom-aligned, with confirmation)
- Close button

**Message history:**
- Infinite scroll upward (pagination 25-50 msgs per load)
- Scroll-to-bottom button (appears when scrolling up)
- Timestamps on hover (desktop) / always visible (mobile)
- User messages: right-aligned + primary color
- Bot messages: left-aligned + surface-secondary background
- Persistent state: remembers scroll position, draft text, reply-to state

### Animations & State
- **Message entrance**: Fade in from bottom (100ms)
- **Loading**: Animated skeleton or indented "Assistant" label with typing dots
- **Error toast**: Slide in from top (240ms ease-out), auto-dismiss 5s
- **Reply preview**: Blue left border accent (Trek design token)

---

## Conversation Flow

### Greeting & Context Setup
**First message (bot-initiated):**
```
"Hi! I'm your trip assistant. I can help you plan activities, manage your budget, 
suggest packing items, and more. What trip are you working on?"
```
- Follow-up quick actions as pill buttons: "Current trip" | "New trip" | "Show tips"
- Context set in ONE turn (user says trip name/ID → bot loads once)

**Once context loaded:**
- Display trip summary card (collapsible, sticky at top)
  ```
  Bali 2025 • Mar 1-15 • 3 members
  Budget: $4,200/person | Packing: 60% done | To-dos: 8 remaining
  ```
- Clicking card navigates to trip in main app

### Multi-Turn Exchanges
**Response with auto-suggestions:**
```
User: "I need packing suggestions"
Bot: [Response with suggestions]
[Auto-footer:]
"Ready to add? [Add to packing list] [Refine suggestions]"
```
- Reduces "what's next?" friction
- Buttons trigger direct app actions

**Clarification strategy:**
- If ambiguous (e.g., "Add accommodation"), ask once with pill options
- Show 3-4 quick-action pills max (don't overwhelm)
- Accept free-text gracefully if user types instead

**Context awareness:**
- Bot always knows current trip + member permissions
- Mention relevant data proactively:
  ```
  "I see your budget is $4,200/person. Adding this $150 restaurant..."
  ```
- Don't ask "which trip?" if only one trip exists

**Conversation length**: Prune old turns after 50+ messages (keep recent, archive rest)

---

## Streaming & Async Patterns

### Token-by-Token Display
- Start rendering on first chunk (50-100ms)
- Display tokens as they arrive (don't wait for full response)
- Monospace font for technical content (airports, reservations)

**Loading state during stream:**
- Message opacity: 0.7 initially, pointer-events: none
- Cursor at end (blinking underline) signals "still thinking"
- No skeleton once streaming starts (jarring transition)

**Cancellation:**
- "Stop generating" button next to typing indicator
- On click → send `cancel()` signal to LLM
- Partial message keeps what was generated; button changes to "Regenerate"

### Loading States
**While fetching trip context:**
- Subtle skeleton card: `[▮▮▮ Loading trip data]` (1.2s shimmer)
- Don't block input — let user type while loading
- On failure: error toast + fallback message

**Network retry:**
- On 5xx/timeout: "Retrying..." badge with auto-retry (2s → 5s → 10s exponential backoff)
- If all retries fail: "Connection lost" button → "Retry" or "Dismiss"

**Concurrent operations:**
- Non-blocking mutations: UI responds instantly
- Mutation runs in background
- Success: subtle toast "Added ✓"
- Failure: persistent error banner above chat (high visibility)

---

## Proactive Assistance

### When to Volunteer Suggestions
**Confidence tiers (use sparingly):**
- **High confidence (bot-initiated)**: Trip just created → "Want me to help plan itinerary?"
- **Medium confidence (reactive)**: Only suggest if user asks related question
- **Low confidence**: Never auto-suggest (wait for user questions)

**Trigger patterns:**
1. Trip just created → "I can help add places, set budget, etc." (once per trip)
2. User mentions weather → "BTW, it'll be 28°C in Tokyo on Day 3. Want packing tips?"
3. User adds expensive item → "Your budget is tight. Want cost optimization tips?" (if >85% spent)
4. Packing list 0% + 2 days before trip → "Your packing list is empty. Need help preparing?"

**Suggestion UI:**
- Collapsible cards below assistant message (less intrusive than inline)
- Card header: "Suggestion" or "Related tip" badge + brief title
- Card content: 2-3 sentences + single action button
- User can dismiss individually (✕ button)

### Confidence Signaling
**Uncertain responses:**
```
"Based on your dates (Mar 1-15), I'd recommend packing layers. 
Note: Weather data is approximate — check closer to your trip."
```
- Highlight uncertainty with `⚠️ Note:` prefix
- Lighter text color for caveats (text-muted)

**Permission limitations:**
```
"I can see your packing list but don't have permission to add items. 
You can authorize access in Settings > Integrations."
```
- Offer fix action: button → Settings page (deep link)

**Confidence meter:** Don't show "87% confident" explicitly. Use framing: "Likely" vs. "Possibly" vs. "I'm not sure, but..."

---

## Error UX

| Error Type | UX Pattern | Action |
|------------|-----------|--------|
| **Rate limit exceeded** | "You've sent many messages. Please wait a moment." (auto-retry 30s) | "Retry now" |
| **Token limit hit** | "Your message is too long. Try asking shorter question." | "Clear history" |
| **Model overloaded** | "Assistant is busy. Retrying..." (show count) | "Cancel" |
| **Content policy violation** | "I can't help with that. Try rephrasing." (no retry) | — |

**Toast positioning**: Bottom-left (above chat input) to avoid blocking messages
**Tone**: Helpful, not blaming ("I can't..." not "You can't...")

### Permission Denials
**Missing OAuth scopes:**
```
"To add items to your packing list, I need permission. 
[Authorize packing:write] (takes 10s)"
```
- Direct OAuth re-consent flow (don't make user go to Settings)
- Show spinner + progress: "Authorizing..." → "✓ Authorized"

**No access to resource:**
```
"I can't see 'Trip X' because you don't have access. 
Ask the trip owner to add you as a member."
```

### Data Loading Errors
**Trip/place not found:**
```
"I couldn't find 'Dubai' in your trip. Your places: Tokyo, Bali, Bangkok. 
Did you mean one of these? [Tokyo] [Bali] [Bangkok]"
```

**Stale data:**
```
"Your accommodation info might be outdated. Last synced 2 hours ago. 
[Refresh] to get latest."
```

---

## Trek Design System Integration

### Color Tokens
- **User message**: `bg-primary-500` text-white
- **Assistant message**: `bg-surface-card` border-edge-faint
- **Action buttons**: `bg-accent` (primary) or `bg-surface-secondary` (secondary)
- **Error toast**: `bg-danger-soft` text-danger
- **Loading skeleton**: `bg-surface-secondary` with shimmer
- **Unread badge**: `bg-primary-600` (bright, high contrast)

### Typography
- **Message text**: `text-body` (14px scaled)
- **Timestamps**: `text-caption text-content-muted` (12px faint)
- **Trip context card**: `text-subtitle` heading + `text-body` details
- **Action button text**: `text-body font-medium`

### Spacing & Layout
- **Message padding**: 12px left/right, 8px top/bottom
- **Chat container gap**: 8px between messages
- **Input area**: 12px horizontal padding
- **Corner radius**: 12px for messages, 20px for input (rounded pill)
- **Modal/sidebar padding**: 12px (consistent with CollabChat)

### Dark Mode Support
- All tokens define dark variants via CSS variables
- Test chat in both modes
- Ensure emoji, code blocks, links readable

### Mobile Considerations
- **Touch targets**: Min 44px height
- **Input height**: 40px (auto-expand textarea, max 100px)
- **Virtual keyboard**: Don't push chat off-screen
- **Orientation changes**: Preserve scroll + draft text

---

## Read/Write Capability Patterns

### Actionable Responses
**Add to packing:**
```
Suggested packing items for Bali:
- Sunscreen (add) [+]
- Rain jacket (add) [+]
- Hat (add) [+]
```
Each item independently clickable

**Create reservation:** Rich card with action buttons
```
[Reservation Card]
Flight: Singapore Airlines SQ123
Date: Mar 1 | Depart: 10:30 → Arrive: 14:15
[Add to trip] [Save as draft]
```

**Budget calculation:** Inline actionable numbers
```
"The total budget is $12,600 for 3 people ($4,200 each).
Current: $8,940 (71%)
Remaining: $3,660 [View breakdown] [Adjust budget]"
```

### Confirmation Pattern
**Destructive actions only:**
```
User: "Delete all to-do items"
Bot: "This will delete 8 to-do items. Ready? [Confirm] [Cancel]"
```

**Non-destructive:** Instant execution, undo toast
```
"Added 3 items to packing list ✓ [Undo]" (auto-dismiss 5s)
```

---

## MVP Implementation Order

1. **Phase 1**: Widget button + modal sidebar (desktop), full-screen (mobile)
2. **Phase 2**: Trip summary card + message history (25 msgs/load)
3. **Phase 3**: Token-by-token streaming + stop button
4. **Phase 4**: Quick-action pills (add packing, create reservation)
5. **Phase 5**: Confidence signaling + 1-2 suggestion patterns
6. **Phase 6**: Error recovery, offline fallbacks, keyboard shortcuts

---

## Key Takeaway

Trek's chatbot should feel like a **smart sidebar assistant**, not separate modal app. Keep it integrated with trip context, use Trek's design tokens for cohesion, prioritize **one-click actions** over explanations.
