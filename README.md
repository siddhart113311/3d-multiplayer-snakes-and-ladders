<div align="center">

# 🐍 Serpentia

### A 3D multiplayer Snakes &amp; Ladders game for the browser

Square, hex **and** triangle boards · roaming Fire-Mode serpents that *swallow* your token ·
online lobbies with join codes · trash-talk chat · 2D/3D toggle · 60 fps on desktop and mobile

*The start screen renders a live, looping 3D board — a token hops across the cells, scales a
ladder, and is swallowed whole by the serpent — previewing whichever board shape and mode
you have selected.*

Built with **Next.js 16** · **React Three Fiber** · **TypeScript** · **Drizzle ORM** · **PostgreSQL** · **Tailwind CSS v4**

</div>

---

## ✨ Features

### Three board topologies
| Board | Layout | Path |
|---|---|---|
| **Classic Square** | `N×N` grid | Boustrophedon (serpentine) |
| **Hive Spiral** | Concentric hex rings | Continuous outward spiral |
| **Prism Peak** | Interlocking triangles | Row-by-row ascent |

Each board is available in **10 size configurations**, from a 25-cell skirmish to a
225-cell epic. All three shapes share identical cell counts at each step, so the size
setting means the same thing whichever board you pick.

### Game modes
- **Classic** — the timeless race to the summit.
- **🔥 Fire Mode** — snakes don't stay put. Every 18 seconds a serpent *migrates* across the
  board, and anyone caught in its path gets **gulped**: jaws flare, your token is swallowed,
  and a visible **bulge travels down the snake's body** before spitting you out at the tail.
- **🎯 Hunt Mode** — the board hunts *you*. Every 2.6 seconds the **five nearest snakes** each
  crawl one cell toward whoever is about to move, jaws parting as they close in. Reach a head
  — or let one reach you — and you're swallowed. Snake positions are no longer fixed, so the
  hazards you memorised last turn have already moved.

### Ways to play
- **Single player** — 0–3 AI opponents across three difficulty tiers, plus a solo **time-attack**
  mode. Runs the full game engine *in the browser*, so there is zero network latency.
- **Online multiplayer** — create a lobby, share the 6-character code, up to 4 players.
  Fill empty seats with bots.

### Presentation
- Custom **tapered snake geometry** with a truly pointed tail, procedurally painted scale/spot
  skin, hinged jaws, fangs and slit-pupil eyes.
- The swallow bulge is a **GPU vertex-shader deformation** of the snake body — not a fake overlay.
- Fully **synthesized audio** (WebAudio) — dice rattles, hops, hisses, gulps, fanfares. No audio assets.
- Screen shake, GPU particle bursts, confetti, and a tumbling CSS 3D dice.
- **2D top-down** or **3D perspective** — toggle any time with `V`.

### Accessibility &amp; platform support
- The camera **fits the board to your viewport exactly** — verified against ~29,000
  viewport/board/view combinations with zero clipping, from a 280px-wide foldable to ultrawide.
- Responsive HUD, safe-area insets for notches, 44px touch targets, pinch-zoom.
- Device-aware pixel-ratio capping to hold 60 fps on phones.

---

## 🎮 Controls

| Action | Keyboard | Touch |
|---|---|---|
| Roll the dice | `Space` / `Enter` | Tap **Roll** |
| Orbit the board | Arrow keys | One-finger drag |
| Zoom | Mouse wheel | Pinch |
| Toggle 2D / 3D | `V` | 3D/2D button |
| Chat | `T` | 💬 button |
| Pause | `P` | ⏸ button |
| Mute | `M` | 🔊 button |

---

## 🚀 Getting started

### Prerequisites
- **Node.js 20+**
- A **PostgreSQL** database (local or hosted — Neon, Supabase, Railway, etc.)

### Installation

```bash
# 1. Clone
git clone https://github.com/<your-username>/serpentia.git
cd serpentia

# 2. Install dependencies
npm install

# 3. Configure your database
cp .env.example .env
#    then edit .env and set DATABASE_URL

# 4. Create the tables
npm run db:push

# 5. Start the dev server
npm run dev
```

Open **http://localhost:3000** and hit **Start run** — you'll be rolling within seconds.

> **Note** `drizzle.config.json` points at the local default
> `postgresql://postgres:postgres@127.0.0.1:5432/app_db`. If your database lives elsewhere,
> update that file as well as `.env`.

### Production build

```bash
npm run build
npm run start
```

---

## 📜 Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:push` | Push the Drizzle schema to PostgreSQL |

---

## 🏗️ Architecture

```
src/
├─ app/
│  ├─ page.tsx              # start screen: board/size/mode picker, hall of fame
│  ├─ solo/page.tsx         # single-player entry (engine runs client-side)
│  ├─ lobby/[id]/page.tsx   # online lobby + join code
│  ├─ game/[id]/            # the live game (transport-agnostic client)
│  └─ api/                  # games, join, actions, chat, scores, health
├─ game/                    # pure, framework-free game logic
│  ├─ engine.ts             # authoritative rules, dice, hazards, fire mode
│  ├─ boards.ts             # topology + world geometry for all 3 shapes
│  ├─ localGame.ts          # runs the engine in-browser for single player
│  ├─ director.ts           # turns server events into 3D choreography
│  ├─ snakeSkin.ts          # tapered geometry + procedural scale texture
│  ├─ viewport.ts           # responsive camera fitting
│  └─ sounds.ts             # WebAudio synthesis
├─ components/three/        # R3F scene: board, snakes, ladders, tokens, particles
└─ db/                      # Drizzle schema + client
```

### Design notes

**One engine, two transports.** `src/game/engine.ts` is the single source of truth for the
rules. Online games run it on the server (state persisted as JSONB); single-player runs the
*same module* in the browser. The game UI talks to both through one `request()` seam, so there
is no duplicated logic and solo play has no network round-trips.

**Event-sourced animation.** Every mutation appends events (`hop`, `ladder`, `snakeBite`,
`snakeShift`, `win`). The client replays them through a **Director** that sequences tweened
choreography. State stays authoritative while animation stays smooth and perfectly ordered —
and the win screen politely waits for the final move to finish playing.

**Performance.** Board cells are drawn with `InstancedMesh` and all cell numbers bake into a
single texture, so a 225-cell board is only a handful of draw calls. Particles are one pooled
GPU point cloud with zero per-frame allocation.

---

## 🗄️ Database schema

Two tables (`src/db/schema.ts`):

- **`games`** — one row per online game; full game state stored as JSONB, keyed by join code.
- **`scores`** — the global hall of fame.

Single-player runs are stored in `localStorage` and never touch the database.

---

## 🚢 Deploying

> **GitHub and GitHub Pages host source/static files only.** Online lobbies use Next.js
> route handlers plus PostgreSQL, so deploy the repository to a server-side Next.js host
> such as Vercel, Railway or Render. A GitHub Pages deployment cannot create or join lobbies.

For **Vercel**:

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Create a hosted PostgreSQL database (Neon, Supabase, Railway, Vercel Postgres, etc.).
4. Add its connection string as `DATABASE_URL` in the Vercel project's Environment Variables.
5. Redeploy.

The multiplayer schema self-initializes on the first request. `npm run db:push` remains
available for local development and explicit schema management.

Open `/api/health` on the deployment to verify setup. A healthy multiplayer backend returns:

```json
{"ok":true,"database":"ready","multiplayer":true}
```

If `DATABASE_URL` is absent or invalid, the start screen displays the configuration error and
keeps Single Player available instead of letting Create Lobby fail mysteriously.

---

## 🤝 Contributing

Issues and pull requests are welcome. Please make sure `npm run typecheck` and
`npm run build` both pass before opening a PR.

## 📄 License

[MIT](LICENSE) — do whatever you like.
