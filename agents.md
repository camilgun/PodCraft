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
- `services/ml` — Python FastAPI, mlx-audio (Qwen3-ASR, Qwen3-TTS, Qwen3-ForcedAligner, NISQA)
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
    └── schemas.py         # Pydantic schemas
```

## Stato recording (state machine)

IMPORTED → TRANSCRIBING → TRANSCRIBED → ANALYZING → REVIEWED → EXPORTING → COMPLETED
Qualsiasi stato può → ERROR. Da ERROR si può → Riprovare.

## Quando hai dubbi

- Se non sai dove mettere un file → guarda la struttura sopra
- Se non sai che tipo usare → guarda `packages/shared/src/types.ts`
- Se non sai se validare → SÌ, valida sempre con Zod/Pydantic
- Se non sai se testare → SÌ, testa sempre
- Non fare scelte architetturali non presenti in questo documento senza chiedere
