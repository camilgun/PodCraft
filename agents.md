# AGENTS.md — PodCraft Development Context

> Leggi SEMPRE questo file prima di iniziare qualsiasi task.

## Progetto

PodCraft è un tool web locale per content creator che trasforma registrazioni audio
grezze in contenuti podcast/YouTube. L'AI trascrive, analizza qualità, propone tagli,
e può rigenerare sezioni scarsa qualità con TTS voice clone.

## Architettura

- **Monorepo Turborepo** con pnpm workspaces
- `apps/web` — Vite, React 19, TypeScript, Tailwind, shadcn/ui, React Router 7, Wavesurfer.js
- `apps/server` — Node.js, Hono, BullMQ + Redis, Drizzle ORM + SQLite
- `packages/shared` — Tipi TypeScript + Zod schemas condivisi
- `services/ml` — Python 3.11 (uv), FastAPI, mlx-audio (Qwen3-ASR, Qwen3-TTS, Qwen3-ForcedAligner, NISQA). Tutti modelli bf16.
- Audio processing: FFmpeg via fluent-ffmpeg

## Regole VINCOLANTI

1. **TypeScript `strict: true`** in tutti i package TS. Zero `any`, mai.
2. **Zod schema** per ogni API request/response e ogni output ML. Validazione runtime sempre.
3. **Pydantic** nel ML service Python. Mirror dei Zod schemas.
4. **Errori espliciti**, mai silenziosi. Usa tipi Result<T, E> dove possibile.
5. **Logging strutturato**: `{ jobId, recordingId, step, status, duration, error? }`
6. **Idempotenza**: ogni job può essere rieseguito senza side-effect.
7. **Test**: ogni funzione pura ha unit test. Ogni job ha test con mock.
8. **Niente `any`**, niente `as any`, niente `@ts-ignore`.
9. **Import da `@podcraft/shared`** per tutti i tipi condivisi.
10. **Naming**: camelCase per TS, snake_case per Python, kebab-case per file.
11. **Database**: ogni modifica al DB (query, insert, update, delete, schema) deve usare Drizzle ORM. Mai SQL raw diretto, mai altri ORM.

## Struttura progetto

```
podcraft/
├── apps/web/src/          # Frontend Vite + React (SPA)
│   ├── pages/             # Route pages
│   ├── components/        # React components
│   ├── hooks/             # Custom hooks
│   ├── stores/            # Zustand stores
│   └── lib/               # Utilities, API client
├── apps/server/src/       # Backend Hono
│   ├── routes/            # API route handlers
│   ├── services/          # Business logic
│   ├── jobs/              # BullMQ job processors
│   ├── db/                # Drizzle schema + migrations
│   └── lib/               # Errors, logger, utils
├── packages/shared/src/   # Shared types & schemas
│   ├── types.ts
│   ├── schemas.ts
│   ├── stateMachine.ts
│   └── constants.ts
└── services/ml/app/       # Python ML service
    ├── routers/           # FastAPI endpoints
    ├── models/            # Model wrappers
    ├── lib/               # Audio, language, memory utils
    └── schemas.py         # Pydantic schemas
```

## Stato recording (state machine)

IMPORTED → TRANSCRIBING → TRANSCRIBED → ANALYZING → REVIEWED → EXPORTING → COMPLETED
Qualsiasi stato operativo (escluso `FILE_MISSING`) può → ERROR. Da ERROR si può → Riprovare.
Qualsiasi stato operativo (escluso `FILE_MISSING`) può → FILE_MISSING (Library Sync non trova il file su disco).
Da FILE_MISSING → IMPORTED (Library Sync ritrova il file, possibilmente con path diverso).

## Identità file (file identity strategy)

Ogni recording ha due riferimenti al file:

- `filePath` (operativo) — path corrente su disco, usato per processare il file
- `fileHash` (canonico) — SHA-256(primi 1 MB del file + file_size_bytes), calcolato una volta all'import

Library Sync usa l'hash per riconciliare quando l'utente rinomina o sposta il file:
→ hash trovato in nuovo path → aggiorna filePath, stato resta invariato
→ hash non trovato da nessuna parte → transita a FILE_MISSING

## Convenzioni Frontend (apps/web)

### Componenti UI

- **shadcn/ui prima di tutto**: prima di scrivere un componente custom, cerca su [ui.shadcn.com](https://ui.shadcn.com/docs/components) — Button, Card, Badge, Dialog, Table, ecc. sono già disponibili. Si aggiungono con `pnpm dlx shadcn@canary add <nome>` dalla dir `apps/web/`.
- I componenti shadcn vivono in `src/components/ui/`. Non modificarli direttamente — sono "owned" dal registry. Wrappali se servono customizzazioni.

### API calls

- **Tutte le chiamate API passano per `src/lib/api-client.ts`**. Mai usare `fetch()` direttamente in componenti o pagine.
- Ogni funzione restituisce `ApiResult<T>` (`{ ok: true; data }` | `{ ok: false; error }`). Gestire sempre entrambi i casi.
- Le URL sono relative (`/api/...`) — il proxy Vite le inoltra a `http://localhost:4000`.
- Se aggiungi una nuova API, aggiungi prima lo schema Zod in `packages/shared` e poi la funzione in `api-client.ts`.

### TypeScript strict — pattern ricorrenti

- **`import type`** obbligatorio per tutti gli import solo-tipo (`verbatimModuleSyntax: true`).
- **Floating promises negli event handler**: usa `void asyncFn()` oppure wrappa in una arrow sync: `onClick={() => { void handleClick(); }}`.
- **`useParams` in React Router 7**: ritorna `string | undefined` — guarda sempre con `if (!id) return` prima di usarlo.
- **Zod `.nullish()` + `exactOptionalPropertyTypes`**: Zod inferisce `T | null | undefined` ma i tipi di dominio usano `?: T | null`. Dopo `safeParse`, fai `as DomainType` — Zod ha già validato la struttura, è solo un disallineamento del type system.

## Git Workflow

Ogni task del sprint ha il suo branch dedicato. Non lavorare mai direttamente su `main`.

### Inizio task

```bash
git checkout main
git checkout -b task/X.Y-slug-breve
# es: task/1.10-transcription-ui
#     task/2.1-bullmq-jobs
#     task/2.3-fix-alignment-endpoint
```

### Review

fai la review sul branch:

```bash
git diff main...HEAD          # tutto il diff accumulato rispetto a main
git log main..HEAD --oneline  # lista commit del branch
```

### Merge su main

```bash
git checkout main
git merge --squash task/X.Y-slug-breve
git commit -m "feat: descrizione finale pulita"
```

Usa il prefisso convenzionale nel commit finale:

- `feat:` — nuova funzionalità
- `fix:` — bugfix
- `refactor:` — refactoring senza cambio comportamento
- `test:` — aggiunta/modifica test
- `chore:` — manutenzione (deps, config, build)

### Cleanup e push

```bash
git branch -d task/X.Y-slug-breve   # rimuovi il branch locale
git push origin main
```

---

## Quando hai dubbi

- Se non sai dove mettere un file → guarda la struttura sopra
- Se non sai che tipo usare → guarda `packages/shared/src/types.ts`
- Se non sai se validare → SÌ, valida sempre con Zod/Pydantic
- Se non sai se testare → SÌ, testa sempre
- Se ti serve un componente UI → cerca prima in shadcn/ui
- Non fare scelte architetturali non presenti in questo documento senza chiedere
