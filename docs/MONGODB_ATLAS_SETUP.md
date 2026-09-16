# Connecting Kosh to MongoDB Atlas

This guide takes you from zero to a Kosh install whose data lives in **MongoDB Atlas** and
**persists across page refreshes and restarts**. It also explains exactly how Kosh performs
Create / Read / Update / Delete (CRUD) against MongoDB.

---

## 1. How Kosh stores data (read this first)

Kosh uses a **ports-and-adapters** store, so the same API code runs against either backend:

| Mode | When it's used | Where data lives | Survives API restart? |
|------|----------------|------------------|-----------------------|
| **In-memory / JSON** (default) | `MONGODB_URI` is **unset** | `apps/api/.data/db.json` on the API host | Yes, as long as `.data/` survives |
| **MongoDB** (recommended) | `MONGODB_URI` is **set** | Your MongoDB / Atlas cluster | Yes — the database is the source of truth |

The **web app** is a client of the API. Its behaviour depends on `VITE_API_URL`:

- **Backend mode** — `VITE_API_URL` is set (our `.env` sets it to `http://localhost:8787/api`).
  The **server is the single source of truth**. The web app does *not* keep a copy in
  `localStorage`; on every load it calls the API to fetch your data.
- **Demo mode** — `VITE_API_URL` is empty. The app runs fully client-side against seeded demo
  data persisted in the browser's `localStorage` (no server, nothing reaches MongoDB).

> **This is the #1 cause of "my data disappeared after refresh":** the web app is in **backend
> mode** but the **API isn't running / reachable**, so your create never reached the database and
> there's nothing to re-fetch on reload. Always run **both** the API and the web app (see §5).

---

## 2. Prerequisites

- Node.js **≥ 22** and `npm` (this repo is an npm-workspaces monorepo).
- A free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) account (the **M0** free
  tier is plenty for development).
- The repo cloned and dependencies installed: `npm install`.

---

## 3. Create a MongoDB Atlas cluster (step by step)

1. **Sign in** at <https://cloud.mongodb.com>.
2. **Create a project** (e.g. `kosh`) — *Projects → New Project*.
3. **Build a cluster** — *Create → Deployment: M0 (Free)*, pick a cloud/region near you, name it
   (e.g. `kosh-dev`), then **Create Deployment**.
4. **Create a database user** (Atlas shows this right after the cluster is created, or under
   *Security → Database Access → Add New Database User*):
   - Authentication method: **Password**.
   - Username: e.g. `kosh_app`. Generate a strong password and **copy it** — you'll need it in the
     connection string.
   - Built-in role: **Read and write to any database** (for dev). In production, scope it to a
     single database with `readWrite` on `kosh` only.
5. **Allow network access** — *Security → Network Access → Add IP Address*:
   - For local dev, **Add Current IP Address**.
   - If your IP changes often (laptop, CI), you may temporarily use `0.0.0.0/0` (allow from
     anywhere). **Never leave `0.0.0.0/0` on for production** — lock it to known IPs/VPC.
6. **Get the connection string** — *Deployment → Database → Connect → Drivers*:
   - Driver: **Node.js**. Copy the URI. It looks like:
     ```
     mongodb+srv://kosh_app:<db_password>@kosh-dev.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=kosh-dev
     ```
   - Replace `<db_password>` with the password from step 4. If your password contains special
     characters (`@ : / ? # [ ] %`), **URL-encode** them (e.g. `@` → `%40`).
   - **Add the database name** right before the `?` so Kosh uses a named database. Use `kosh`:
     ```
     mongodb+srv://kosh_app:s3cret@kosh-dev.xxxxx.mongodb.net/kosh?retryWrites=true&w=majority&appName=kosh-dev
     ```

---

## 4. Point Kosh at your cluster

Edit the **repo-root `.env`** (both apps read this file) and set `MONGODB_URI`:

```dotenv
# apps/web — keep backend mode on (this is what makes the app talk to the API + DB)
VITE_API_URL=http://localhost:8787/api

# apps/api — set this to your Atlas connection string (include the /kosh database name)
MONGODB_URI=mongodb+srv://kosh_app:s3cret@kosh-dev.xxxxx.mongodb.net/kosh?retryWrites=true&w=majority

# strong secrets (required in production; any value works in dev)
SESSION_SECRET=<random-32+-chars>
ENCRYPTION_KEY=<random-32+-chars>
DEV_LOGIN=1
```

> `.env` is **gitignored** — never commit real credentials. Keep `MONGODB_URI` out of version
> control and out of screenshots.

---

## 5. Run it (both processes)

```bash
npm install

# terminal 1 — API on :8787 (connects to Atlas because MONGODB_URI is set)
npm run api

# terminal 2 — web on :5173 (talks to the API above)
npm run web
```

…or run both at once with `npm run dev` (Turborepo runs every workspace's `dev`).

Open <http://localhost:5173>. `DEV_LOGIN=1` auto-signs-you-in.

---

## 6. Verify the connection

- **API log** on startup prints `db: connecting to MongoDB` (the in-memory adapter instead prints
  `db: using in-memory/JSON store …`). If you see the in-memory message, `MONGODB_URI` didn't load —
  check the `.env` path and spelling.
- **Health check**: `curl http://localhost:8787/api/health` returns OK.
- **Atlas Data Explorer**: after you add a skill/prompt/link in the app, open
  *Atlas → Browse Collections → database `kosh`* and you'll see the collections fill up (see §7).
- **The real test**: add a skill, **refresh the page** — it's still there. Stop and restart
  `npm run api` — still there. That's persistence working.

---

## 7. How CRUD works in Kosh (Create / Read / Update / Delete)

Every write follows the same path, so the frontend contract stays identical whether the store is
Mongo or the JSON fallback:

```
UI action → useData store action (optimistic update) → typed API client (apps/web/src/data/api.ts)
          → Express route (apps/api/src/routes/*.ts) → store adapter (db/mongoose.ts) → MongoDB
```

Kosh maps to these **MongoDB collections** (`apps/api/src/db/mongoose.ts`):

| Collection | Holds | Key indexes |
|------------|-------|-------------|
| `users` | one document per signed-in user | unique `githubId` |
| `items` | links, repos, prompt & skill cards, files | unique `(userId, urlHash)`, `(userId, kind, deletedAt, createdAt)` |
| `skills` | skill records + versions | `(userId, name)` |
| `collections` | user collections | `(userId, slug)` |
| `apiKeys` | hashed API keys (never plaintext) | unique `keyHash` |
| `storageObjects` | content-addressed file metadata | unique `(userId, sha256)` |
| `uploadSessions` | in-flight presigned uploads | TTL on `expiresAt` |

### Create
Adding a skill (`POST /api/skills`), prompt (`POST /api/prompts`), link (`POST /api/items`), or
publishing a repo (`POST /api/repos/publish`) inserts a document via the adapter's `create()`:

```ts
// db/mongoose.ts
await model.create({ _id: doc.id ?? randomUUID(), ...doc }); // → db.<collection>.insertOne(...)
```

### Read
Listing (`GET /api/items`, `/api/skills`, `/api/collections`, `/api/trash`) and search
(`GET /api/search`) call `find()` / `findOne()`, always scoped to the current `userId`:

```ts
await model.find({ userId, deletedAt: null }).sort({ createdAt: -1 }).lean();
```

### Update
Editing an item (`PATCH /api/items/:id`), rating/staging it, versioning a skill
(`POST /api/skills/:id/versions`), or renaming tags uses `updateById()` / `updateOne()`, which
issue a MongoDB `$set` (a partial merge, not a full overwrite):

```ts
await model.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
```

### Delete
Items are **soft-deleted** first (`DELETE /api/items/:id` sets `deletedAt`, moving them to Trash for
30 days) and can be **restored** (`POST /api/items/:id/restore`). **Purge** (`DELETE /api/trash/:id`
or *Empty trash*) removes the document permanently via `deleteById()`:

```ts
await model.findByIdAndDelete(id).lean(); // → db.<collection>.deleteOne({ _id: id })
```

### Inspecting / editing data directly (optional)
With `mongosh` (or the Atlas Data Explorer):

```js
use kosh
db.skills.find({ userId: "<your-user-id>" })      // read
db.items.countDocuments({ deletedAt: null })       // read
db.items.updateOne({ _id: "<id>" }, { $set: { stage: "using" } })  // update
db.items.deleteOne({ _id: "<id>" })                // delete
```

---

## 8. Persistence & security notes

- **Source of truth is MongoDB.** In backend mode the browser keeps no durable copy, so what you
  see after a refresh is exactly what's in the database. If something you added isn't there after a
  refresh, the write didn't reach the API (see Troubleshooting).
- **Secrets at rest.** GitHub tokens and similar secrets are encrypted with `ENCRYPTION_KEY`
  (AES-256-GCM) before they're written; API keys are stored **hashed** (SHA-256), never in plaintext.
  Set strong, random `SESSION_SECRET` and `ENCRYPTION_KEY` — the API refuses to start in
  `NODE_ENV=production` with the placeholder dev values.
- **Least privilege.** Give the Atlas DB user `readWrite` on the `kosh` database only, and restrict
  Network Access to known IPs (or your server's VPC) in production.
- **Backups.** Atlas M10+ tiers include automated backups; enable them for production.

---

## 9. Troubleshooting

| Symptom | Cause & fix |
|---------|-------------|
| **New skills/prompts/repos vanish after refresh** | The API isn't running or `VITE_API_URL` points at a dead API. Start `npm run api` (and confirm the log says it connected to MongoDB), then reload. The app now surfaces a clear "can't reach the API" banner instead of silently showing demo data. |
| API log says *in-memory/JSON store* though you set the URI | `.env` didn't load or the var name is wrong. It must be `MONGODB_URI` in the **repo-root** `.env`. Restart `npm run api` after editing. |
| `MongoServerError: bad auth : authentication failed` | Wrong username/password in the URI, or special characters not URL-encoded. Re-copy the password; encode `@ : / ? # %`. |
| `querySrv ENOTFOUND` / `getaddrinfo ENOTFOUND` | The cluster host in the URI is wrong, or DNS/network is blocking the SRV lookup. Re-copy the string from *Connect → Drivers*. |
| Connection hangs / times out | Your IP isn't in *Network Access*. Add your current IP (or `0.0.0.0/0` for dev only). |
| Data shows in demo mode but never in Atlas | `VITE_API_URL` is empty, so the app is in demo mode (localStorage). Set it to `http://localhost:8787/api` and reload. |

---

## 10. Going to production

- Set `NODE_ENV=production`, strong `SESSION_SECRET` / `ENCRYPTION_KEY`, and `COOKIE_SECURE=1`.
- Use a dedicated Atlas project/cluster, a least-privilege DB user, and a locked-down IP allowlist.
- Put the API behind HTTPS and set `APP_URL` / `API_URL` to your real hosts.
- For file uploads at scale, configure Cloudflare R2 (`R2_*` vars) so bytes bypass the API.
