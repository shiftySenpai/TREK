# Coding Conventions

**Analysis Date:** 2026-07-15

## Naming Patterns

**Files:**
- Services: `{domain}Service.ts` (e.g., `tagService.ts`, `journeyShareService.ts`)
- React Components: PascalCase (e.g., `TodoRow.tsx`, `TodoListPanel.tsx`, `BudgetPanelSummary.tsx`)
- Utilities: camelCase (e.g., `formatters.ts`, `avatarSrc.ts`, `dayMerge.ts`)
- Tests: `.test.ts`, `.test.tsx`, `.spec.ts` (co-located in src/ or in dedicated tests/ directories)

**Functions and Methods:**
- camelCase throughout (e.g., `listTags`, `createTag`, `formatMoney`, `resolveDayId`, `formatLocationName`)
- Verb-first pattern for service methods: `createX`, `getX`, `updateX`, `deleteX`, `listX`
- Getter functions: `is*` or `get*` (e.g., `isOwner`, `getTagByIdAndUser`)

**Variables:**
- camelCase (e.g., `isSelected`, `assignedUser`, `itemId`, `const uploadsDir`)
- Boolean prefixes: `is*`, `can*`, `has*` (e.g., `canEdit`, `isDone`, `hasCategory`)

**Types and Interfaces:**
- PascalCase for all types (e.g., `Trip`, `TodoItem`, `Day`, `Assignment`, `PackingItem`)
- Suffixes: `*Config`, `*Settings`, `*Info`, `*Permissions` (e.g., `JourneySharePermissions`, `BackupSettings`)

**Constants:**
- SCREAMING_SNAKE_CASE for true constants (e.g., `ZERO_DECIMAL_CURRENCIES`, `CURRENCY_LOCALE`, `PRIO_CONFIG`)

## Code Style

**Formatting:**
- Prettier 3.8.3+
- **Client** (`.prettierrc`):
  - printWidth: 120
  - useTabs: false, tabWidth: 2
  - singleQuote: true
  - semi: true
  - trailingComma: es5
  - arrowParens: always
  - jsxSingleQuote: false (JSX props use double quotes)
  - bracketSpacing: true
  - endOfLine: lf
  - Plugins: prettier-plugin-organize-imports, @trivago/prettier-plugin-sort-imports, prettier-plugin-tailwindcss

- **Server** (`.prettierrc`):
  - printWidth: 120
  - singleQuote: true
  - trailingComma: all (CommonJS end-of-file handling)
  - Plugins: prettier-plugin-organize-imports, @trivago/prettier-plugin-sort-imports

**Linting:**
- ESLint with TypeScript (eslint-config-flat-gitignore, typescript-eslint)
- Config: `client/eslint.config.mjs`, `server/eslint.config.mjs`
- React: react-hooks, react-refresh plugins in client
- Severity tuned to warnings for pre-existing violations (not errors)
  - `@typescript-eslint/no-explicit-any`: warn
  - `@typescript-eslint/no-unused-vars`: warn (allows `_prefixed` args/vars to signal intent)
  - React-specific: rules-of-hooks and exhaustive-deps at warn level

**TypeScript Configuration:**
- **Client** (`client/tsconfig.json`):
  - target: ES2020
  - module: ESNext (ESM)
  - jsx: react-jsx
  - strict: false (allows flexibility on existing codebase)
  - moduleResolution: bundler
  - Path aliases: @trek/shared

- **Server** (`server/tsconfig.json`):
  - target: ES2022
  - module: commonjs
  - experimentalDecorators: true (NestJS requirement)
  - emitDecoratorMetadata: true
  - strict: false
  - Path aliases for @modelcontextprotocol/sdk workarounds

## Import Organization

**Order (enforced by prettier-plugin-sort-imports):**
1. Standard library and node_modules (packages starting with a-zA-Z)
2. Relative/aliased paths (starting with @, ./, ../)
   - Path aliases: `@/`, `@trek/shared`
   - Relative: `./`, `../`

**Import Statements:**
- Group imports from the same source together
- importOrderSeparation: true (blank line between import groups)
- Use named imports for specificity (avoid `import * as` unless necessary)
- Example from `src/utils/formatters.ts`:
  ```typescript
  import type { AssignmentsMap, Day } from '../types'
  // (blank line)
  export function formatLocationName(...) { ... }
  ```

**Path Aliases:**
- Client: `@trek/shared` points to `../shared/src/index.ts` (shared domain types)
- Shared re-exports domain schemas and types to be consumed by both client and server

## Error Handling

**Patterns:**
- try/catch blocks for async operations and potential throws
- Example from `src/index.ts`:
  ```typescript
  try { parsedAppUrl = new URL(process.env.APP_URL); } catch { /* invalid */ }
  ```
- Null checks before dereferencing (e.g., `if (!existing) return null`)
- Type assertions with `as` keyword when the type is known (e.g., `const row = db.prepare(...).get(id) as any`)
- Service functions return `null` to indicate not found or error conditions
- Graceful fallbacks (e.g., locale defaults to 'en-US' if not found)

## Logging

**Framework:** console.log/console.error (Node.js built-in)

**Patterns:**
- Simple console logging at startup (banner in `src/index.ts`)
- `require('./services/auditLog')` at runtime for structured logging (logInfo, logError, logWarn)
- Environment variable `LOG_LEVEL` controls verbosity (default: 'info')
- Tests suppress logs: `LOG_LEVEL=error` in test setup

## Comments

**When to Comment:**
- Complex algorithms or domain logic (e.g., postcode detection regex in formatters.ts)
- Inline implementation notes explaining "why" not "what"
- Deferred work or known limitations marked with TODO/FIXME
- Example from `formatters.ts`:
  ```typescript
  // Dedup preserving insertion order
  const seen = new Set<string>()
  ```

**JSDoc/TSDoc:**
- Used for public function exports
- Format: `/** description */` for single-line, multi-line for complex signatures
- No @param/@returns tags in most cases; signature is self-documenting
- Example from `formatters.ts`:
  ```typescript
  /**
   * Locale- and currency-correct money formatting via Intl...
   */
  export function formatMoney(
    value: number,
    currency: string,
    locale: string,
    opts?: { decimals?: number },
  ): string
  ```

## Function Design

**Size:** Most functions 10–50 lines; complex domain logic (e.g., database queries) may be longer

**Parameters:**
- Positional for required args, optional trailing for configuration objects
- Example: `createTag(userId: number, name: string, color?: string)`
- Inline type annotations for clarity

**Return Values:**
- Explicit return types on exported functions
- Void for mutations, specific types for data-returning functions
- `null` to indicate "not found" or error state (rather than throwing)
- Union types for complex returns (e.g., `{ token: string; created: boolean } | null`)

## Module Design

**Exports:**
- Named exports for functions and types
- Single default export only for React components (PascalCase files)
- Service modules export multiple named functions (create, list, update, delete)

**Barrel Files:**
- Used sparingly; `src/types.ts` re-exports domain types from `@trek/shared`
- `client/tests/helpers/` has index files aggregating factories and test utilities

**File Organization:**
- `/src/services/` — domain-specific logic (tagService, journeyShareService, etc.)
- `/src/utils/` — reusable utilities (formatters, date helpers)
- `/src/api/` — HTTP client and API configuration
- `/src/store/` — state management (Zustand stores in client)
- `/src/db/` — database access layer (better-sqlite3 in server)
- `/tests/unit/` — isolated unit tests
- `/tests/integration/` — integration tests that may touch DB, HTTP
- `/tests/helpers/` — factories, mocks, test utilities
- `/e2e/` — end-to-end tests (Playwright on client)

---

*Convention analysis: 2026-07-15*
