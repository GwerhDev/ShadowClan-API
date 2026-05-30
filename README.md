# ShadowClan API

Node.js · Express · MongoDB · Socket.IO backend for the ShadowClan clan-management platform for Diablo Immortal.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript (ts-node in dev) |
| Framework | Express 4 |
| Database | MongoDB via Mongoose 7 |
| Auth | Battle.net OAuth (passport-bnet) + JWT cookie |
| Real-time | Socket.IO 4 |
| Testing | Jest + ts-jest |

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB instance (local or Atlas)
- Battle.net developer app credentials

### Install

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=8080
NODE_ENV=development

MONGODB_STRING=mongodb://localhost:27017/shadowclan

BNET_CLIENT=your_bnet_client_id
BNET_SECRET=your_bnet_client_secret

PRIVATE_SECRET=your_jwt_secret

API_URL=http://localhost:8080
CLIENT_URL=http://localhost:5174
APP_CLIENT_URL=http://localhost:5173
DASHBOARD_URL=http://localhost:5175

ALLOWED_ORIGINS=["http://localhost:5173","http://localhost:5174","http://localhost:5175"]

TIMEZONE_OFFSET=-3

# Production overrides (used when NODE_ENV=production)
API_URL_PROD=
CLIENT_URL_PROD=
APP_CLIENT_URL_PROD=
DASHBOARD_URL_PROD=
ALLOWED_ORIGINS_PROD=
```

### Run

```bash
# Development (nodemon + ts-node)
npm run dev

# Production build
npm run build    # outputs to dist/
npm start        # runs dist/index.js

# Tests
npm test
npm run test:coverage
```

---

## Architecture

### Entry Points

| File | Purpose |
|---|---|
| `src/index.ts` | HTTP server bootstrap, Socket.IO init |
| `src/app.ts` | Express app, CORS, session, passport |
| `src/routes/index.ts` | Top-level route mounting + middleware |
| `src/config/index.ts` | Environment config object |
| `src/socket.ts` | Socket.IO server factory |

### Key Helpers

| File | Purpose |
|---|---|
| `src/helpers/clanScope.ts` | Resolve a character's clan ID from `Character.clan` |
| `src/helpers/getUser.ts` | Decode JWT from request and return the User document |
| `src/integrations/jwt.ts` | Create / decode JWT tokens |
| `src/middlewares/index.ts` | `authorizeRoles()` — role-based route guard |

---

## Authentication

Authentication is cookie-based. After a successful Battle.net OAuth login, a signed JWT is issued and stored in the `u_tkn` cookie. The cookie is also accepted as `Authorization: Bearer <token>` for API clients that cannot use cookies.

**Login flow:**

1. `GET /login-bnet` — redirects the user to Battle.net OAuth
2. Battle.net redirects to `GET /login-bnet/callback`
3. On success the server issues the `u_tkn` JWT cookie and redirects to the client app
4. `GET /logout` — clears the cookie and destroys the session

Every protected request is validated by `authorizeRoles()` in `src/middlewares/index.ts`, which decodes the JWT, looks up the user in MongoDB, and checks the role.

---

## Permission Model

### System Role (stored on `User.role`)

Controls which routes a user can reach.

```
walker → user → leader / officer → admin → super_admin
```

| Role | Access |
|---|---|
| `walker` / `user` | Standard authenticated routes |
| `leader` / `officer` | `/clan-management/*` routes |
| `admin` / `super_admin` | `/clan-management/*` + `/admin/*` |

### Character-Level Clan Role

Stored in the `Clan` document (`leader`, `officer[]`, `member[]`). Enforced inside each controller — not by route middleware.

- A character is a **leader** / **officer** if their ID appears in `Clan.leader` / `Clan.officer[]`.
- A character is a **walker** if `Character.clan` is `null` (no clan affiliation).

### Character-Scoped Requests

Every request that returns clan data must include the active character's ID so the backend can scope the response to that character's clan. Client-side filtering is not used.

- **GET** requests: `?characterId=<id>` query param
- **POST / PATCH** requests: `characterId` in the request body

---

## API Reference

Base URL (dev): `http://localhost:8080`

All authenticated endpoints require the `u_tkn` cookie or `Authorization: Bearer <token>` header.

---

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/auth` | ✓ | Current user info (user + character array) |
| `DELETE` | `/auth` | ✓ | Delete own account |

---

### Login / OAuth

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/login-bnet` | — | Start Battle.net OAuth flow |
| `GET` | `/login-bnet/callback` | — | OAuth callback (handled by passport) |
| `GET` | `/login-bnet/success` | — | OAuth success redirect |
| `GET` | `/login-bnet/failure` | — | OAuth failure redirect |
| `GET` | `/logout` | ✓ | Clear `u_tkn` cookie and session |

---

### Character

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/character/:id` | ✓ | Get a character by ID |
| `POST` | `/character` | ✓ | Create a character |
| `PUT` | `/character/:id` | ✓ | Update a character |
| `GET` | `/character/search?q=` | ✓ | Search characters by name |

---

### Clan

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/clan?name=` | ✓ | Search clans by name |

---

### Shadow War (member view)

Any authenticated user can use these endpoints to view and confirm attendance for their own character.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/shadow-war/active?characterId=` | ✓ | Active/next shadow war for a character's clan |
| `PATCH` | `/shadow-war/:id/confirm` | ✓ | Confirm attendance for all assigned characters |

---

### Accursed Tower (member view)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/accursed-tower/active?characterId=` | ✓ | Active / upcoming towers for a character's clan |
| `PATCH` | `/accursed-tower/:id/confirm` | ✓ | Confirm attendance. Body: `{ characterId? }` |

---

### Clan Post (feed)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/clan-post?characterId=&page=` | ✓ | Paginated clan feed (20 posts per page) |
| `POST` | `/clan-post` | ✓ | Create a post. Body: `{ characterId, content, source?, referenceId? }` |
| `PATCH` | `/clan-post/:id` | ✓ | Edit post content (leader / officer only). Body: `{ content }` |
| `DELETE` | `/clan-post/:id` | ✓ | Delete a post (leader / officer only) |

`source` values: `general` · `shadow_war` · `accursed_tower`

---

### Clan Request

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/clan-request` | ✓ | Submit a join request. Body: `{ characterId, clanId }` |
| `GET` | `/clan-request/manage?characterId=` | ✓ | Pending requests for the character's clan (leader / officer) |
| `PATCH` | `/clan-request/:id` | ✓ | Accept or reject a request. Body: `{ status: 'accepted' \| 'rejected' }` |

---

### Clan Invitation

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/clan-invitation` | ✓ | Pending invitations for the current user's characters |
| `PATCH` | `/clan-invitation/:id` | ✓ | Accept or reject an invitation. Body: `{ status: 'accepted' \| 'rejected' }` |

---

### Task

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/task` | ✓ | Create a task |
| `PATCH` | `/task/:id` | ✓ | Update a task |
| `DELETE` | `/task/:id` | ✓ | Delete a task |

---

### Completed Task

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/completed-task` | ✓ | Mark a task as completed |
| `PATCH` | `/completed-task/:id` | ✓ | Update / unmark a completed task |

---

### Warband

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/warband` | ✓ | Retrieve warbands |

---

### Crest

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/crest` | ✓ | Add a crest entry |
| `PATCH` | `/crest/:id` | ✓ | Update a crest entry |
| `DELETE` | `/crest/:id` | ✓ | Remove a crest entry |

---

### Character Claim

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/character-claim` | ✓ | Submit a claim for an unclaimed character |
| `GET` | `/character-claim` | ✓ | List own pending / resolved claims |

---

### Character Creation Request

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/character-creation-request` | ✓ | Request that an admin create a new character |
| `GET` | `/character-creation-request` | ✓ | List own requests |

---

### Clan Management

Requires system role `leader`, `officer`, `admin`, or `super_admin`. All endpoints that return clan-scoped data require `?characterId=` (GET) or `characterId` in the body (POST/PATCH).

#### Shadow Wars

| Method | Path | Description |
|---|---|---|
| `GET` | `/clan-management/shadow-wars?characterId=&page=&limit=` | Paginated shadow war list |
| `GET` | `/clan-management/shadow-wars/by-date?characterId=&date=` | Shadow war on a specific date (`YYYY-MM-DD`) |
| `GET` | `/clan-management/shadow-wars/:id?characterId=` | Single shadow war (fully populated) |
| `POST` | `/clan-management/shadow-wars` | Create shadow war. Body: `{ characterId, date, enemyClan? }` |
| `PATCH` | `/clan-management/shadow-wars/:id` | Update war (rosters, date, enemy clan, result). Body includes `characterId` |
| `PATCH` | `/clan-management/shadow-wars/:id/confirm` | Leader / officer confirms own attendance |
| `POST` | `/clan-management/shadow-wars/:id/respond` | Respond / confirm a character. Body: `{ characterId? }` |
| `DELETE` | `/clan-management/shadow-wars/:id?characterId=` | Delete shadow war |

#### Accursed Tower

| Method | Path | Description |
|---|---|---|
| `GET` | `/clan-management/accursed-tower?characterId=` | List non-completed towers |
| `GET` | `/clan-management/accursed-tower/active?characterId=` | Active / upcoming towers |
| `GET` | `/clan-management/accursed-tower/clans?q=` | Search clans by name (enemy clan lookup) |
| `POST` | `/clan-management/accursed-tower/clans` | Create a new enemy clan. Body: `{ characterId, name }` |
| `GET` | `/clan-management/accursed-tower/:id?characterId=` | Single tower (fully populated) |
| `POST` | `/clan-management/accursed-tower` | Create tower. Body: `{ characterId, towerNumber, date, enemyClan? }` |
| `PATCH` | `/clan-management/accursed-tower/:id` | Update tower (roster, date, result, completed). Body includes `characterId` |
| `POST` | `/clan-management/accursed-tower/:id/respond` | Respond / confirm. Body: `{ characterId? }` |
| `DELETE` | `/clan-management/accursed-tower/:id?characterId=` | Delete tower |

#### Clan (Member Management)

| Method | Path | Description |
|---|---|---|
| `GET` | `/clan-management/clan/:clanId` | Clan details + pending invitations |
| `POST` | `/clan-management/clan/:clanId/members` | Add an existing character to the clan. Body: `{ characterId }` |
| `DELETE` | `/clan-management/clan/:clanId/members/:characterId` | Remove a member (cannot remove the leader) |
| `POST` | `/clan-management/clan/:clanId/characters` | Create and add a new unclaimed character. Body: `{ name, resonance?, currentClass? }` |
| `PATCH` | `/clan-management/clan/:clanId/members/:characterId` | Update member stats. Body: `{ currentClass?, resonance?, memberStatus? }` |
| `PATCH` | `/clan-management/clan/:clanId/members/:characterId/role` | Change role (leader only). Body: `{ role: 'officer' \| 'member' }` |
| `GET` | `/clan-management/clan/:clanId/invitations` | List pending invitations sent by the clan |
| `POST` | `/clan-management/clan/:clanId/invitations` | Send an invitation. Body: `{ characterId, role?, proposedClass?, proposedResonance? }` |
| `DELETE` | `/clan-management/clan/:clanId/invitations/:invitationId` | Cancel a pending invitation |

#### History

| Method | Path | Description |
|---|---|---|
| `GET` | `/clan-management/history?characterId=&type=&page=&limit=` | Paginated event history. `type`: `shadow_war` · `accursed_tower` (omit for both) |

---

### Admin

Routes under `/admin` are reserved for the Dashboard app. Require system role `admin` or `super_admin`. Covers user activation, character claim review, character creation request review, clan management, fixed task administration, and warband configuration.

---

## Real-Time Events (Socket.IO)

The server authenticates socket connections using the same `u_tkn` JWT and joins each socket to a private `user:{userId}` room.

| Event | Direction | Payload | Trigger |
|---|---|---|---|
| `shadowwar:assigned` | Server → client | `{ shadowWarId, characterId, characterName, date }` | A character is added to a shadow war roster |
| `clan:member-removed` | Server → client | `{ clanName, characterId }` | A character is removed from a clan |
| `clan-invitation:new` | Server → client | `{ id, clan, character, role, proposedClass, proposedResonance, createdAt }` | A clan invitation is sent to a character |

All socket emissions are wrapped in try/catch — a socket failure never breaks the HTTP response.

---

## Running Tests

```bash
npm test                 # run all tests once
npm run test:watch       # watch mode
npm run test:coverage    # coverage report
```

Test files live in `src/__tests__/`. Global test setup (environment variables) is in `src/__tests__/setup.ts`.
