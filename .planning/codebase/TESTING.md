# Testing Patterns

**Analysis Date:** 2026-07-15

## Test Framework

**Runner:**
- Vitest 4.1.9 (both client and server)
- Config: `client/vitest.config.ts`, `server/vitest.config.ts`

**Assertion Library:**
- Vitest built-in (expect from vitest)

**Run Commands:**

```bash
# Both client and server
npm run test              # Run all tests (single run)
npm run test:watch       # Watch mode (re-run on file change)
npm run test:coverage    # Generate coverage report

# Client specific
npm run test:unit        # Unit tests only (tests/unit/)
npm run test:integration # Integration tests (tests/integration + src/**/*.test.*)
npm run e2e              # Playwright end-to-end tests

# Server specific
npm run test:unit        # Unit tests only (tests/unit/)
npm run test:integration # Integration tests (tests/integration/)
npm run test:ws          # WebSocket tests (tests/websocket/)
npm run test:e2e         # E2E tests (tests/e2e/)
```

## Test File Organization

**Location:**

- **Client:**
  - Co-located: `src/**/*.test.tsx` (near implementation)
  - Centralized: `tests/unit/`, `tests/integration/`, `tests/setup.ts`
  - E2E: `e2e/*.spec.ts` (Playwright)

- **Server:**
  - Centralized: `tests/unit/`, `tests/integration/`, `tests/websocket/`, `tests/e2e/`
  - Setup: `tests/setup.ts`, `tests/helpers/`

**Naming:**
- `.test.ts` or `.test.tsx` for Vitest tests
- `.spec.ts` for Playwright e2e tests
- Factories: `tests/helpers/factories.ts`
- Test utilities: `tests/helpers/` (mocks, auth helpers, test-db utilities)

**Structure:**
```
client/
├── src/
│   ├── store/
│   │   ├── tripStore.ts
│   │   └── tripStore.test.ts        (co-located)
│   └── utils/
│       ├── formatters.ts
│       └── formatters.test.ts        (co-located)
├── tests/
│   ├── unit/                         (store tests, hook tests, etc.)
│   ├── integration/                  (shared-contract, multi-store scenarios)
│   ├── helpers/
│   │   ├── factories.ts              (buildUser, buildTrip, etc.)
│   │   ├── store.ts                  (resetAllStores)
│   │   └── msw/
│   │       └── server.ts             (MSW server setup)
│   └── setup.ts                      (global test setup)
└── e2e/
    ├── login.public.spec.ts
    └── create-trip.spec.ts

server/
├── src/
│   ├── services/
│   │   └── tagService.ts
│   └── ...
└── tests/
    ├── unit/
    │   └── scheduler.test.ts
    ├── integration/
    │   └── auth.test.ts
    ├── helpers/
    │   ├── factories.ts               (createUser, createTrip, etc.)
    │   ├── auth.ts                    (authCookie, authHeader)
    │   └── test-db.ts                 (resetTestDb, resetRateLimits)
    └── setup.ts                       (global test setup)
```

## Test Structure

**Suite Organization:**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('featureName', () => {
  // Setup
  beforeEach(() => {
    // Test-specific initialization
  })

  afterEach(() => {
    // Cleanup
  })

  // Test cases
  it('description of expected behavior', () => {
    // Arrange: set up test data
    const input = buildTrip()
    
    // Act: invoke the code
    const result = formatMoney(100, 'EUR', 'en-US')
    
    // Assert: verify the outcome
    expect(result).toBe('€100.00')
  })
})
```

**Patterns:**

- **Setup:** `beforeEach` for per-test initialization (resetAllStores, resetTestDb)
- **Teardown:** `afterEach` for cleanup (localStorage clear, server reset)
- **Globals:** `beforeAll`/`afterAll` for suite-level setup (start MSW server, build NestJS app)
- **Mocking:** `vi.mock()` at top level (hoisted) before imports

## Mocking

**Framework:** Vitest's `vi` module

**Patterns:**

```typescript
// Module mocking — hoisted to top (vi.hoisted prevents ReferenceError)
const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  return { testDb: db, dbMock: { /* ... */ } }
})

vi.mock('../../src/db/database', () => dbMock)
vi.mock('../../src/websocket', () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getSocketId: vi.fn(() => null),
}))
```

**HTTP Mocking (Client):**
- MSW (Mock Service Worker) for HTTP interception
- Server: `tests/helpers/msw/server.ts` (setupServer)
- Handlers: `http.get()`, `http.post()` with HttpResponse.json()
- Lifecycle: `beforeAll(() => server.listen())`, `afterEach(() => server.resetHandlers())`, `afterAll(() => server.close())`

**What to Mock:**
- External APIs (HTTP calls, WebSocket)
- File I/O (fs module in server tests)
- Time-dependent operations (Date, setTimeout)
- Database connections (in unit tests; integration tests use in-memory DB)
- Third-party SDKs (crypto, nodemailer, etc.)

**What NOT to Mock:**
- Utility functions (formatters, helpers) — test the real implementation
- Store logic (unit tests for stores test actual behavior, not mocks)
- Database queries in integration tests — use in-memory testDb instead

## Fixtures and Factories

**Test Data:**

```typescript
// client/tests/helpers/factories.ts
let _seq = 0
function next(): number { return ++_seq }

export function buildUser(overrides: Partial<User> = {}): User {
  const id = next()
  return {
    id,
    username: `user${id}`,
    email: `user${id}@example.com`,
    role: 'user',
    avatar_url: null,
    created_at: '2025-01-01T00:00:00.000Z',
    mfa_enabled: false,
    must_change_password: false,
    ...overrides,
  }
}

export function buildTrip(overrides: Partial<Trip> = {}): Trip {
  const id = next()
  return {
    id,
    user_id: 1,
    title: `Trip ${id}`,
    currency: 'EUR',
    start_date: '2025-06-01',
    end_date: '2025-06-05',
    ...overrides,
  }
}
```

**Location:**
- Client: `client/tests/helpers/factories.ts`
- Server: `server/tests/helpers/factories.ts`
- Factories use an auto-incrementing counter so each call produces unique IDs

**Usage:**
```typescript
const trip = buildTrip({ title: 'My Trip' })
const user = buildUser({ role: 'admin' })
```

## Coverage

**Requirements:**
- **Client:** No enforced gate (informational)
- **Server:** 80% coverage threshold for `src/nest/**/*.ts` (statements, branches, functions, lines)
  - Legacy code in `src/` is intentionally ungated
  - New NestJS modules must meet DoD threshold; ratchet as more modules migrate

**View Coverage:**
```bash
npm run test:coverage          # Generates coverage/ directory
# Reports available in coverage/lcov-report/index.html
```

**Provider:**
- **Client:** v8 (vitest built-in)
- **Server:** istanbul (via @vitest/coverage-istanbul)
  - Reason: SWC decorator transformation causes v8 branch coverage under-reporting (~68% even with full test pass)
  - istanbul instruments source directly, independent of transform pipeline

## Test Types

**Unit Tests:**
- Scope: Single function or component
- Location: `tests/unit/` or co-located `.test.ts`
- Dependencies: Mocked (DB, API, external services)
- Speed: <1s per test
- Example: `tests/unit/scheduler.test.ts` (buildCronExpression)

**Integration Tests:**
- Scope: Multiple components interacting (e.g., store + API)
- Location: `tests/integration/`
- Dependencies: Real in-memory DB (server), MSW for HTTP (client)
- Speed: 1–5s per test
- Example: `tests/integration/auth.test.ts` (login flow with DB)

**E2E Tests:**
- Scope: Full user workflows (client-to-server-to-DB)
- Framework: Playwright (client e2e)
- Location: `e2e/` (.spec.ts files)
- Dependencies: Live app running
- Speed: 5–30s per test
- Example: `e2e/login.public.spec.ts`, `e2e/create-trip.spec.ts`

## Common Patterns

**Async Testing:**
```typescript
it('loads trip data', async () => {
  const store = useTripStore()
  await store.loadTrip(123)
  expect(store.trip?.id).toBe(123)
})
```

**Error Testing:**
```typescript
it('throws on invalid input', () => {
  expect(() => resolveDayId([], 'invalid-date')).not.toThrow()
  expect(resolveDayId([], 'invalid-date')).toBe('')
})
```

**Mocking Callbacks:**
```typescript
it('calls onSelect when clicking row', () => {
  const onSelect = vi.fn()
  render(<TodoRow item={buildTodoItem()} onSelect={onSelect} ... />)
  const row = screen.getByRole('button')
  user.click(row)
  expect(onSelect).toHaveBeenCalledWith(1)
})
```

**Database Setup (Server Integration):**
```typescript
const { testDb, dbMock } = vi.hoisted(() => {
  const db = new Database(':memory:')
  // Set pragmas for test consistency
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  return { testDb: db, dbMock: { /* factory methods */ } }
})

beforeAll(async () => {
  createTables(testDb)
  runMigrations(testDb)
  nestApp = await buildApp()
})

beforeEach(() => {
  resetTestDb(testDb)  // Clear test data between runs
})
```

**Supertest for API Testing (Server):**
```typescript
import request from 'supertest'

it('AUTH-001 — successful login returns 200', async () => {
  const { user, password } = createUser(testDb)
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password })
  expect(res.status).toBe(200)
  expect(res.body.user.email).toBe(user.email)
})
```

## Test Configuration Details

**Client vitest.config.ts:**
- environment: custom jsdom (jsdom-native-abort.ts for abort controller)
- globals: true (no need to import describe/it/expect)
- pool: forks (isolate tests in separate processes)
- testTimeout: 15000ms
- setupFiles: tests/setup.ts (global mocks, jsdom stubs)
- Coverage: v8 provider, exclude main.tsx and vite-env.d.ts

**Server vitest.config.ts:**
- SWC transform plugin (for NestJS decorator metadata)
- globals: true
- pool: forks
- testTimeout: 15000ms
- setupFiles: tests/setup.ts (environment variables)
- Coverage: istanbul provider, exclude plugin-host-entry.ts

**Global Setup (client/tests/setup.ts):**
```typescript
// MSW server lifecycle
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()  // React Testing Library cleanup
  localStorage.clear()
  sessionStorage.clear()
})
afterAll(() => server.close())

// jsdom stubs: matchMedia, IntersectionObserver, ResizeObserver, scrollIntoView
// Locale fix: toLocaleDateString defaults to en-US for deterministic tests
```

**Global Setup (server/tests/setup.ts):**
```typescript
process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2'
process.env.NODE_ENV = 'test'
process.env.COOKIE_SECURE = 'false'
process.env.LOG_LEVEL = 'error'  // suppress logs in test output
```

---

*Testing analysis: 2026-07-15*
