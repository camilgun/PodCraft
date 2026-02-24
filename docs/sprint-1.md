# Sprint 1 — Spike Tecnico + Fondamenta ✅ COMPLETATO

> Archivio. Sprint completato a febbraio 2026.
> Per il sprint corrente vedi `docs/sprint-2.md`.

**Obiettivo**: Validare che lo stack ML funzioni sul M4 Max, e montare lo scheletro del progetto su cui tutto il resto si costruisce. A fine sprint: un monorepo funzionante con un'UI minima che mostra i file dalla cartella e permette di trascriverne uno.

---

## Task 1.1 — Setup monorepo e infrastruttura ✅

**Cosa fare:**

- Inizializzare il monorepo con Turborepo
- Creare i 3 workspace: `apps/web`, `apps/server`, `packages/shared`
- Configurare TypeScript `strict: true` in tutti i package con `tsconfig.base.json` condiviso
- Setup linting (ESLint + Prettier) con config condivisa
- Setup Vitest config condivisa
- Configurare Turborepo per orchestrare dev mode di tutti i servizi
- Baseline runtime: Node 24 LTS + pnpm 10.29.3

**Struttura risultante:**

```
podcraft/
├── package.json (workspaces)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── apps/
│   ├── web/          (Vite + React 19, conferma che builda)
│   └── server/       (Hono app con health check GET /)
└── packages/
    └── shared/       (package con un tipo esportato, conferma import cross-workspace)
```

**Criterio di completamento:**

- `pnpm dev` avvia frontend (localhost:5173) e backend (localhost:4000)
- Frontend mostra una pagina placeholder
- Backend risponde a `GET /health` con `{ status: "ok" }`
- Il package `shared` è importabile da entrambi gli app
- Zero errori TypeScript

---

## Task 1.2 — Setup ML Service Python ✅

**Cosa fare:**

- Creare `services/ml/` con FastAPI
- `pyproject.toml` con dipendenze: `fastapi`, `uvicorn`, `mlx-audio`, `pydantic`
- Endpoint health check `GET /health`
- Configurare `HF_HOME` nel `.env` per storage modelli in posizione dedicata (default: `~/.podcraft/models/`)
- Script `scripts/download-models.sh` che scarica i modelli MLX da HuggingFace:
  - `mlx-community/Qwen3-ASR-1.7B-bf16` (~4.08 GB) — bf16 verificato disponibile
  - `mlx-community/Qwen3-ForcedAligner-0.6B-bf16` (~1.84 GB) — bf16 verificato disponibile
  - `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` (~4.54 GB) — bf16 full precision
  - Peso NISQA via torchmetrics (download automatico al primo uso, ~50 MB)
- Orchestrazione dev via Turborepo (package.json wrapper in services/ml/)

**Python tooling**: `uv` per gestione dipendenze e venv. `.python-version = 3.11`.

**Perché bf16 ovunque:**

- Con 36 GB di RAM non c'è pressione a quantizzare (~10.5 GB totale per tutti i modelli)
- La trascrizione è asincrona, la velocità extra della quantizzazione non migliora la UX
- La qualità è prioritaria: nessun compromesso su precisione transcript e naturalezza TTS

**Criterio di completamento:**

- ✅ `uv run uvicorn app.main:app` avvia il servizio su localhost:5001
- ✅ `GET /health` risponde con lista modelli disponibili e il loro path
- ✅ Test passano (4/4)
- ✅ Turborepo integration funzionante

---

## Task 1.3 — Spike ASR: trascrivere una registrazione reale ✅

**Endpoint implementato:** `POST /transcribe`

**Schema response:**

```python
class TranscribeResponse(BaseModel):
    text: str
    language: str
    inference_time_seconds: float
    audio_duration_seconds: float
    model_used: str
```

**Benchmark su M4 Max:**

- Transcript italiano: 4/5 — comprensibile e vicino alla baseline Whisper, con qualche imprecisione lessicale
- Filler words: parzialmente (forte su "cioè", debole su "ehm/allora")
- Tempo di inference warm (1 min audio): 2.294 secondi
- Tempo di inference cold: 5.705 secondi
- Tempo di inference (10 min audio): 34.480 secondi
- RAM picco: 3.780 GB (RSS processo)
- Decisione: ✅ Confermato Qwen3-ASR

---

## Task 1.4 — Spike Alignment: timestamps word-level ✅

**Endpoint implementato:** `POST /align`

**Schema response:**

```python
class AlignedWord(BaseModel):
    word: str
    start_time: float
    end_time: float

class AlignResponse(BaseModel):
    words: list[AlignedWord]
    inference_time_seconds: float
    model_used: str
```

**Benchmark su M4 Max:**

- Precisione timestamp: 4/5 — verifica proxy 5/5 su prime parole
- Tempo di inference: 1.544 secondi su audio da 22.059s (~4.20 sec/min)
- RAM delta/peak: +0.606 GB / 4.848 GB
- Decisione: ✅ Confermato Qwen3-ForcedAligner

---

## Task 1.5 — Spike TTS: voice clone ✅ (endpoint implementato)

**Endpoint implementato:** `POST /synthesize`

**Specifica:**

- Accetta: `{ text, reference_audio (3s min), reference_text?, language }`
- Vincolo hard: `reference_audio` minimo 3.0 secondi
- Se `reference_text` assente → auto-trascritto con Qwen3-ASR (per ICL voice cloning)
- Response: WAV binary + custom headers (X-Inference-Time-Seconds, X-Audio-Duration-Seconds, ecc.)

**File implementati:**

- `app/routers/tts.py` — POST /synthesize (multipart)
- `app/models/tts_model.py` — lazy-cached model loader con thread-safe locking
- `app/lib/language.py` — risoluzione lingua condivisa ASR + TTS
- `app/lib/audio.py` — `normalize_audio_for_tts_reference()` (mono 24kHz WAV)
- 25 test (13 unit + 12 test lingua), tutti passano

**Benchmark (da completare con modello scaricato):**

- Qualità voice clone: [da testare]
- Naturalezza per podcast: [da testare]
- Performance: [da testare]

---

## Task 1.6 — Spike Quality Assessment: NISQA ✅

**Endpoint implementato:** `POST /assess-quality`

**Schema response:**

```python
class QualityWindow(BaseModel):
    window_start: float
    window_end: float
    mos: float
    noisiness: float
    discontinuity: float
    coloration: float
    loudness: float

class QualityResponse(BaseModel):
    windows: list[QualityWindow]
    average_mos: float
    inference_time_seconds: float
```

**Parametri opzionali:** `window_seconds` (default 3s), `min_window_seconds` (eredita da window_seconds se assente). Guardrail: entrambi >= 1s.

**Benchmark:**

- MOS riflette qualità percepita: Sì (trend coerente)
- Zone rumorose: MOS 3.8336 → 2.5937 nella metà degradata
- Soglia 3.0 ragionevole: ✅ Confermata come default

---

## Task 1.7 — Database e tipi fondamentali ✅

**File creati:**

- `packages/shared/src/types.ts` — tutti i tipi di dominio + ML response types
- `packages/shared/src/schemas.ts` — Zod schemas per tutti i tipi domain + ML
- `packages/shared/src/stateMachine.ts` — `canTransition(from, to)` + `VALID_TRANSITIONS`
- `packages/shared/src/constants.ts` — `QUALITY_THRESHOLD_DEFAULT`, `SUPPORTED_AUDIO_FORMATS`, `ML_SERVICE_BASE_URL_DEFAULT`, `FILE_HASH_WINDOW_BYTES`
- `apps/server/src/db/schema.ts` — 5 tabelle Drizzle (recordings, transcriptions, quality_scores, analysis_results, edit_proposals)
- `apps/server/src/db/index.ts` — auto-migration WAL mode, foreign keys
- `apps/server/src/db/seed.ts` — 3 recording test (IMPORTED, TRANSCRIBED, ERROR)
- `apps/server/src/lib/library-reconciliation.ts` — pure reconciliation function (anticipata)

**Note tecniche:**

- `better-sqlite3` addon nativo: build approvata via `pnpm.approvedBuilds`
- Segments e chapters: JSON nel DB (non normalizzati)
- `edit_proposals` legata a `analysis_results` tramite FK obbligatoria
- Schema v0 non includeva `file_hash` / `file_last_checked_at` — aggiunti nella migration `0001_uneven_tag.sql`
- Vincoli identity aggiunti in `0002_nervous_maverick.sql`: `UNIQUE(file_path)` + index su `file_hash`

**Risultato:** 106 test TypeScript passano (101 shared + 5 server). DB si crea automaticamente alla prima run.

---

## Task 1.8 — Library Sync + API base ✅

**Algoritmo di riconciliazione (in ordine di priorità):**

1. Path trovato in DB → match diretto; se hash manca, popola `fileHash`
2. Path non trovato + hash match su una sola entry `FILE_MISSING` → aggiorna `filePath`, torna a `IMPORTED`
3. Path non trovato + hash match su più entry `FILE_MISSING` → caso ambiguo, no auto-link
4. Nessun match → crea nuova entry `IMPORTED` con `fileHash` + `fileLastCheckedAt`
5. DB entry non matchata → transita a `FILE_MISSING`

**File creati:**

- `apps/server/src/config.ts` — env config (`RECORDINGS_DIR` obbligatorio, `DATABASE_URL`, `PORT`)
- `apps/server/src/lib/file-hash.ts` — `computeFileHash()`: SHA-256(first 1MB || size_LE64)
- `apps/server/src/lib/ffprobe.ts` — `probeAudioFile()`: ffprobe CLI + Zod validation
- `apps/server/src/services/library.ts` — `runLibrarySync()`: scan flat dir, probe+hash, reconcile, tx DB
- `apps/server/src/routes/recordings.ts` — GET /api/recordings, GET /api/recordings/:id, POST /api/recordings/:id/transcribe
- `apps/server/src/routes/library-routes.ts` — POST /api/library/sync
- `apps/server/src/routes/files.ts` — GET /api/files/:id/audio (streaming + Range 206)

**Risultato:** 12 test TypeScript passano. Zero errori TypeScript.

---

## Task 1.9 — UI Library View ✅

**File creati:**

- `apps/web/src/lib/api-client.ts` — Typed fetch functions con `ApiResult<T>`, Zod validation
- `apps/web/src/lib/format.ts` — Pure functions: `formatDuration`, `formatDate`, `formatFileSize`
- `apps/web/src/components/status-badge.tsx` — Badge con colore per ogni `RecordingStatus`
- `apps/web/src/components/recording-card.tsx` — Card con metadata + bottone Trascrivi
- `apps/web/src/pages/library-page.tsx` — Griglia recordings, auto-sync on mount
- `apps/web/src/pages/recording-detail-page.tsx` — Detail view + audio player HTML5
- `apps/web/src/App.tsx` / `main.tsx` — React Router 7 BrowserRouter + Routes

**Note tecniche:**

- Tailwind v4 via `@tailwindcss/vite` plugin (no `tailwind.config.js`)
- shadcn/ui via `pnpm dlx shadcn@canary init` (stile new-york, neutral, CSS variables)
- Vite proxy `/api` → `http://localhost:4000`
- Path alias `@/*` → `./src/*`
- `as Recording` cast necessario per `exactOptionalPropertyTypes` vs `.nullish()` Zod

**Risultato:** 145 test totali passano. Zero errori TypeScript.

---

## Task 1.10 — Integrazione verticale: Trascrizione E2E ✅

**File creati:**

- `apps/server/src/lib/ml-client.ts` — HTTP client tipizzato per ML service (`mlTranscribe`, `mlAlign`)
- `apps/server/src/lib/segment-grouper.ts` — `groupWordsIntoSegments()`: pure function (gap ≥ 1s o maxWords=15)
- `apps/server/src/services/transcription-pipeline.ts` — `runTranscriptionPipeline()`: ASR → Align → grouping → DB transaction
- `apps/server/src/jobs/queue.ts` — BullMQ `Queue("transcription")` con Redis
- `apps/server/src/jobs/worker.ts` — BullMQ `Worker` concurrency=1
- `apps/server/src/routes/transcription-routes.ts` — `GET /api/recordings/:id/transcription`
- `apps/web/src/hooks/use-recording-poller.ts` — hook polling 2s mentre status = TRANSCRIBING
- `apps/web/src/components/transcript-viewer.tsx` — segmenti clickabili, highlight, auto-scroll

**Note tecniche:**

- BullMQ richiede Redis: `brew services start redis` o `redis-server`
- WebSocket rimandato a Sprint 2 — polling 2s sufficiente per Sprint 1
- `groupWordsIntoSegments` in `lib/segment-grouper.ts` (puro, no dipendenze esterne) per test isolati
- `AlignedWord.confidence = 1.0` (aligner non produce confidence)

**Risultato:** 278 test totali passano (102 ML + 105 shared + 42 server + 29 web). Zero errori TypeScript.

**Demo di chiusura sprint:**

1. ✅ Apro localhost:5173 → vedo la lista dei file audio reali
2. ✅ Clicco "Trascrivi" su una registrazione
3. ✅ Vedo un indicatore di progresso
4. ✅ Quando finisce, vedo il transcript
5. ✅ Clicco su una frase → l'audio parte da quel punto
6. ✅ L'audio avanza → il testo si evidenzia in sync

---

## Output dello Sprint 1 — Decisioni confermate

### ASR (Qwen3-ASR-1.7B-bf16)

- Qualità transcript IT: 4/5
- Performance: 2.28 sec/min (warm, 1 min), 3.38 sec/min (10 min), 5.66 sec/min (cold)
- RAM picco: 3.78 GB
- **Decisione: ✅ Confermato**

### Alignment (Qwen3-ForcedAligner-0.6B-bf16)

- Precisione timestamp: 4/5 — output coerente e monotono
- Performance: 4.20 sec/min (1.544s su audio da 22.059s)
- RAM delta/peak: +0.606 GB / 4.848 GB
- **Decisione: ✅ Confermato**

### TTS (Qwen3-TTS-12Hz-1.7B-Base-bf16)

- Endpoint implementato; spike da completare con modello scaricato
- **Decisione: in attesa di test**

### Quality Assessment (NISQA)

- Affidabilità scoring: 4/5 — trend coerente su test controllato
- Soglia 3.0 confermata come default ragionevole
- **Decisione: ✅ Confermato**
