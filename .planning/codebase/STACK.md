# Technology Stack

**Analysis Date:** 2026-07-15

## Languages

**Primary:**
- TypeScript 6.0.2 - Full application (server, client, shared)

**Secondary:**
- JavaScript (Node.js scripts for build and CLI tooling)

## Runtime

**Environment:**
- Node.js 24 (Alpine Linux in Docker, Debian slim for production)
- Browser (React 19.2.6, modern ES2020+ support)

**Package Manager:**
- npm with workspaces
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- **NestJS** 11.1.24 - Backend API framework with Express adapter
- **React** 19.2.6 - Frontend UI framework (enforced workspace-wide via overrides in `package.json`)
- **React Router DOM** 6.22.2 - Client-side routing

**Build/Dev:**
- **Vite** 8.1.0 - Frontend build tool (`client/vite.config.js`)
- **TypeScript** 6.0.2 - Type checking and compilation
- **tsx** 4.21.0 - TypeScript executor for Node.js (server scripts)
- **tsdown** 0.22.2 - Build tool for shared package (dual CJS/ESM output)

**Testing:**
- **Vitest** 4.1.9 - Unit/integration test runner
  - Coverage: `@vitest/coverage-v8` (client), `@vitest/coverage-istanbul` (server)
  - Config: `client/vitest.config.ts`, `server/vitest.config.ts`
- **Playwright** 1.60.0 - E2E browser testing (client)
- **@testing-library/react** 16.3.2 - React component testing
- **MSW** 2.13.0 - Mock Service Worker for API mocking
- **jsdom** 29.0.1 - DOM implementation for Node.js tests

**Code Quality:**
- **ESLint** 10.2.1 (client), 9.18.0 (server) - Linting
- **Prettier** 3.8.3 - Code formatting
- **prettier-plugin-organize-imports** 4.3.0 - Import sorting
- **prettier-plugin-tailwindcss** 0.8.0 - Tailwind CSS class sorting (client)

## Key Dependencies

**Critical:**
- **better-sqlite3** 12.8.0 - Synchronous SQLite client (native bindings)
- **Express** 4.18.3 - Underlying HTTP server (NestJS platform)
- **@modelcontextprotocol/sdk** 1.28.0 - Model Context Protocol integration

**Authentication & Security:**
- **@simplewebauthn/server** 13.1.2 - WebAuthn/passkey server
- **@simplewebauthn/browser** 13.1.2 - WebAuthn/passkey browser
- **jsonwebtoken** 9.0.2 - JWT token signing/verification
- **bcryptjs** 2.4.3 - Password hashing
- **otplib** 12.0.1 - TOTP/OTP generation for MFA

**Data Validation & Serialization:**
- **zod** 4.3.6 - Runtime schema validation (shared across client/server)
- **isomorphic-dompurify** 3.15.0 - XSS sanitization

**UI & Visualization:**
- **Leaflet** 1.9.4 - Map rendering library
- **mapbox-gl** 3.22.0 - Mapbox maps
- **maplibre-gl** 5.24.0 - MapLibre (open-source alternative)
- **react-leaflet** 5.0.0 - React bindings for Leaflet
- **react-leaflet-cluster** 4.1.3 - Clustering plugin for maps
- **lucide-react** 0.344.0 - Icon library
- **Tailwind CSS** 3.4.1 - Utility-first CSS framework
- **@react-pdf/renderer** 4.5.1 - PDF generation

**Media & Image Handling:**
- **sharp** 0.35.1 - High-performance image processing (native bindings)
- **jimp** 1.6.1 - Pure JavaScript image manipulation
- **heic-to** 1.4.2 - HEIC/HEIF image conversion
- **qrcode** 1.5.4 - QR code generation

**HTTP & Networking:**
- **axios** 1.6.7 - HTTP client (with SSRF guards)
- **undici** 7.0.0 - Modern fetch implementation
- **nodemailer** 9.0.1 - SMTP email sending
- **ws** 8.21.0 - WebSocket support (pinned via overrides)

**Data Parsing & Processing:**
- **marked** 18.0.0 - Markdown parsing
- **react-markdown** 10.1.0 - React markdown rendering
- **remark-gfm** 4.0.1 - GitHub Flavored Markdown plugin
- **remark-breaks** 4.0.0 - Line break conversion
- **rehype-sanitize** 6.0.0 - HTML sanitization
- **fast-xml-parser** 5.5.10 - XML parsing
- **pdf-parse** 2.4.5 - PDF text extraction

**File & Archive Handling:**
- **archiver** 6.0.1 - ZIP/archive creation
- **unzipper** 0.12.3 - ZIP file extraction
- **multer** 2.2.0 - File upload middleware (pinned via overrides)

**State & Data Management:**
- **Dexie** 4.4.2 - IndexedDB wrapper (client offline cache)
- **zustand** 4.5.2 - Lightweight state management (client)
- **rxjs** 7.8.2 - Reactive programming (server)
- **node-cron** 4.2.1 - Scheduled job execution

**Utilities:**
- **uuid** 14.0.0 - UUID generation
- **semver** 7.7.4 - Semantic versioning
- **topojson-client** 3.1.0 - GeoJSON/TopoJSON operations
- **tz-lookup** 6.1.25 - Timezone lookup by coordinates
- **dotenv** 16.4.1 - Environment variable loading
- **tsconfig-paths** 4.2.0 - TypeScript path aliasing
- **reflect-metadata** 0.2.2 - Metadata reflection (NestJS)

**Web Authn & Identity:**
- **cookie-parser** 1.4.7 - HTTP cookie parsing
- **compression** 1.8.0 - HTTP response compression
- **helmet** 8.1.0 - Security headers middleware
- **cors** 2.8.5 - CORS middleware

**Development & Build:**
- **concurrently** 10.0.3 - Run multiple commands in parallel
- **nodemon** 3.1.0 - Auto-reload development server
- **@swc/core** 1.15.40 - Fast TypeScript/JavaScript transpiler
- **autoprefixer** 10.4.18 - CSS vendor prefixing
- **postcss** 8.4.35 - CSS transformation framework

**Fonts:**
- **@fontsource/geist-sans** 5.2.5 - Geist Sans font
- **@fontsource/poppins** 5.2.7 - Poppins font

**Client Interactivity:**
- **react-window** 2.2.7 - Virtualization for large lists
- **react-dropzone** 14.4.1 - File drop zone component
- **drag-drop-touch** 1.3.1 - Touch-friendly drag & drop
- **plyr** 3.8.4 - Video player

## Configuration

**Environment:**
- Configured via `.env` and `.env.local` files (client-side uses Vite `import.meta.env.*`)
- Server uses `dotenv` package to load environment variables
- Key variables documented in `docker-compose.yml` comments:
  - `ENCRYPTION_KEY` - At-rest encryption key (auto-generated if unset)
  - `APP_URL` - Public base URL (required for OIDC)
  - `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` - OpenID Connect config
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` - Email config
  - `UNSPLASH_ACCESS_KEY` - Optional Unsplash API key
  - `ALLOWED_ORIGINS` - CORS origins

**Build:**
- Client: `client/vite.config.js` - Vite configuration with React plugin
- Server: `server/tsconfig.json`, `server/vitest.config.ts`
- Shared: `shared/tsconfig.json` - Dual CJS/ESM build
- TypeScript configurations with path aliases via `tsconfig-paths`

**Linting/Formatting:**
- ESLint config: `eslint.config.mjs` (flat config in all packages)
- Prettier config: `.prettierrc` (each package)
- All code formatted with Prettier + import sorting

## Platform Requirements

**Development:**
- Node.js ≥18 (engine specified in plugin-sdk)
- npm (workspace support required)
- TypeScript 6.0.2+
- Optional: Playwright for E2E tests

**Production:**
- Node.js 24 (Alpine 3.20 in Docker, Debian 13 slim)
- **Native dependencies:**
  - `better-sqlite3` - Requires native compilation
  - `sharp` - Requires native binding (with platform-specific prebuilt binaries)
  - **kitinerary-extractor** - C++ library (libkitinerary-bin from Debian packages)
- System packages in Docker:
  - `tzdata` - Timezone database
  - `dumb-init` - Process reaper
  - `wget` - Health check utility
  - `ca-certificates` - TLS trust store
  - `python3`, `build-essential` - Build tools (removed after native compilation)
- File system: `/app/data` (SQLite DB, encryption key, backups), `/app/uploads` (user files, photos, covers, avatars)
- Memory: Minimal (single-threaded event loop, no worker pools by default)
- Disk: Varies with data volume (SQLite DB grows with trips/places/media)

---

*Stack analysis: 2026-07-15*
