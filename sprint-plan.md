# PodCraft — Sprint Plan

> Il primo sprint è dettagliato. Gli altri sono bozze che verranno dettagliati
> uno alla volta, alla luce dei risultati dello sprint precedente.
> Se lo Sprint 1 rivela problemi con lo stack ML, si aggiorna la Source of Truth
> e si riadattano tutti gli sprint successivi.

---

## Sprint 1 — Spike Tecnico + Fondamenta

**Obiettivo**: Validare che lo stack ML funzioni sul M4 Max, e montare lo scheletro del progetto su cui tutto il resto si costruisce. A fine sprint: un monorepo funzionante con un'UI minima che mostra i file dalla cartella e permette di trascriverne uno.

**Durata stimata**: 3-5 giorni

### Task 1.1 — Setup monorepo e infrastruttura

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

### Task 1.2 — Setup ML Service Python ✅

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
- Lo script deve usare `huggingface-cli download` con `--local-dir` che punta a `HF_HOME`
- Orchestrazione dev via Turborepo (package.json wrapper in services/ml/)
- Aggiornare `.env.example` con `HF_HOME` e i model IDs

**Risultato verifica bf16**: Tutte le versioni bf16 sono disponibili su mlx-community, incluso ForcedAligner (precedentemente indicato come "solo 8-bit"). Usato bf16 ovunque.

**Python tooling**: `uv` per gestione dipendenze e venv. `.python-version = 3.11`.

**Perché bf16 ovunque:**
- Con 36 GB di RAM non c'è pressione a quantizzare (~10.5 GB totale per tutti i modelli)
- La trascrizione è asincrona, la velocità extra della quantizzazione non migliora la UX
- La qualità è prioritaria: nessun compromesso su precisione transcript e naturalezza TTS
- Totale download: ~10.5 GB, totale RAM picco stimato (lazy loading): ~10-12 GB

**Criterio di completamento:**
- ✅ `uv run uvicorn app.main:app` avvia il servizio su localhost:5001
- ✅ `GET /health` risponde con lista modelli disponibili e il loro path
- ✅ Test passano (4/4)
- ✅ Turborepo integration funzionante (`pnpm dev`, `turbo run test/lint`)
- I modelli vanno scaricati con `./scripts/download-models.sh` (non eseguito in questa sessione)
- I modelli persistono tra riavvii (non vengono riscaricati)

---

### Task 1.3 — Spike ASR: trascrivere una registrazione reale ✅

**Cosa fare:**
- Implementare `POST /transcribe` nel ML service:
  - Accetta un file audio (multipart)
  - Accetta opzionalmente `language` (multipart) come hint lingua
  - Carica Qwen3-ASR (lazy load, prima invocazione lenta poi cache)
  - Restituisce `{ text, language, duration_ms }`
- Testare con un file reale da `/Users/iubenda/registrazioni`
- Misurare: tempo di inference, qualità del transcript italiano, RAM usata

**Schema response (Pydantic):**
```python
class TranscribeResponse(BaseModel):
    text: str
    language: str
    inference_time_seconds: float
    audio_duration_seconds: float
    model_used: str
```

**Cosa valutare (checklist da compilare):**
- [x] Il transcript italiano è comprensibile e accurato? (Sì, con piccole imprecisioni)
- [x] I filler words (ehm, allora, cioè) vengono trascritti? (Parzialmente: forte su "cioè", debole su "ehm/allora")
- [x] Tempo di inference per 1 min di audio: 2.294 secondi (warm), 5.705 secondi (cold)
- [x] Tempo di inference per 10 min di audio: 34.480 secondi
- [x] RAM picco durante inference: 3.780 GB (RSS processo)
- [x] Errori o crash? Descrizione: nessun crash endpoint durante benchmark; crash MLX solo in sandbox isolata

**Decisione da prendere dopo il test:**
- ✅ Qualità OK → si conferma Qwen3-ASR, si procede
- ⚠️ Qualità mediocre → si confronta con Whisper-large-v3-turbo via mlx-audio
- ❌ Qualità scarsa o crash → si passa a Whisper-large-v3-turbo come fallback

---

### Task 1.4 — Spike Alignment: timestamps word-level ✅

**Cosa fare:**
- Implementare `POST /align` nel ML service:
  - Accetta audio + testo (dal task 1.3) + `language` opzionale
  - Qwen3-ForcedAligner produce timestamps per ogni parola
  - Restituisce array di `{ word, start_time, end_time }`
- Testare: verificare che i timestamp corrispondano all'audio reale

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

**Cosa valutare:**
- [x] I timestamp sono accurati? (verifica proxy su 5 parole: 5/5 match via micro-clip + ASR)
- [x] Funziona con il testo italiano prodotto da Qwen3-ASR? (Sì)
- [x] Tempo di inference: 1.544 secondi su audio da 22.059s (~4.20 sec/min)
- [x] RAM aggiuntiva: 0.606 GB (delta RSS), picco processo 4.848 GB

**Decisione:**
- ✅ Preciso → si conferma
- ❌ Impreciso → si valuta WhisperX come alternativa per l'alignment

---

### Task 1.5 — Spike TTS: voice clone ✅ (endpoint implementato, spike da eseguire con modello scaricato)

**Cosa fare:**
- ✅ Implementare `POST /synthesize` nel ML service:
  - Accetta: `{ text, reference_audio (3s clip), reference_text?, language }`
  - Vincolo hard: `reference_audio` deve avere durata minima di 3.0 secondi
  - `reference_text` opzionale: se assente/vuoto viene auto-trascritto con Qwen3-ASR e usato come `ref_text` per ICL voice cloning
  - Qwen3-TTS genera audio con voce clonata
  - Restituisce il file audio WAV (binary response, metriche negli header)
- Testare: estrarre 3 secondi dalla registrazione reale, clonare la voce, generare una frase nuova
- Confronto A/B: ascoltare la voce originale vs TTS clonato

**Implementazione:**
- `app/routers/tts.py` — POST /synthesize (multipart: text, reference_audio, reference_text, language)
- `app/models/tts_model.py` — lazy-cached model loader con thread-safe double-checked locking
- `app/lib/language.py` — risoluzione lingua condivisa ASR + TTS (TTS: 10 lingue supportate)
- `app/lib/audio.py` — `normalize_audio_for_tts_reference()` (mono 24kHz WAV)
- Response: WAV binary + custom headers (X-Inference-Time-Seconds, X-Audio-Duration-Seconds, X-Model-Used, X-Peak-Memory-GB, X-Delta-Memory-GB)
- 13 unit test + 12 test lingua = 25 nuovi test, tutti passano (73 totali)

**Cosa valutare:**
- [ ] La voce clonata è riconoscibile come la stessa persona?
- [ ] La naturalezza è accettabile per un podcast?
- [ ] Artefatti audio evidenti?
- [ ] Tempo di generazione per 10 secondi di audio: **\_** secondi
- [ ] RAM aggiuntiva: **\_** GB

**Decisione:**
- ✅ Accettabile → si conferma locale
- ⚠️ Mediocre → si implementa switch a Qwen3-TTS API (cloud, qualità migliore)
- ❌ Scarso → si implementa switch a ElevenLabs API

---

### Task 1.6 — Spike Quality Assessment: NISQA ✅

**Cosa fare:**
- ✅ Implementare `POST /assess-quality` nel ML service:
  - Accetta audio
  - NISQA analizza e restituisce scores
  - Per audio lungo: analisi a finestre configurabili (`window_seconds`, default 3s)
  - Tail finale sotto soglia minima viene merge-ato alla finestra precedente
  - `window_seconds` e `min_window_seconds` opzionali via API; se `min_window_seconds` non è passato eredita `window_seconds`
  - Guardrail: entrambi i valori devono essere >= 1s (e `min_window_seconds <= window_seconds`)
- ✅ Testare con un audio di buona qualità e uno con problemi noti (rumore, distorsione)

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

**Cosa valutare:**
- [x] I punteggi MOS riflettono la qualità percepita? (Sì, trend coerente su clip pulita vs degradata)
- [x] Le zone rumorose hanno MOS significativamente più basso? (Sì, 3.8336 -> 2.5937 nella metà degradata)
- [x] La soglia 3.0 sembra ragionevole come default? (Sì, buona separazione nelle prove; da ritarare solo su casi borderline)

---

### Task 1.7 — Database e tipi fondamentali ✅

**Cosa fare:**
- Definire tutti i tipi in `packages/shared` (TypeScript + Zod):
  - `Recording`, `RecordingStatus`, `Transcription`, `AlignedSegment`, `AlignedWord`, `QualityScore`, `EditProposal`
  - Zod schemas corrispondenti per validazione runtime
  - State machine: funzione `canTransition(from, to): boolean`
- Setup Drizzle ORM + SQLite in `apps/server`:
  - Schema DB che rispecchia i tipi
  - Migration iniziale
  - Seed script con dati di test

**Risultato:**
- ✅ `packages/shared/src/types.ts` — tutti i tipi di dominio + ML response types (rinominato `AlignedWord` ML → `MlAlignedWord`)
- ✅ `packages/shared/src/schemas.ts` — Zod schemas per tutti i tipi domain + ML
- ✅ `packages/shared/src/stateMachine.ts` — `canTransition(from, to)` + `VALID_TRANSITIONS`
- ✅ `packages/shared/src/constants.ts` — `QUALITY_THRESHOLD_DEFAULT`, `SUPPORTED_AUDIO_FORMATS`, `ML_SERVICE_BASE_URL_DEFAULT`, `FILE_HASH_WINDOW_BYTES`
- ✅ `apps/server/src/db/schema.ts` — 5 tabelle Drizzle (recordings, transcriptions, quality_scores, analysis_results, edit_proposals)
- ✅ `apps/server/src/db/index.ts` — auto-migration WAL mode, foreign keys
- ✅ `apps/server/src/db/seed.ts` — 3 recording test (IMPORTED, TRANSCRIBED, ERROR)
- ✅ `apps/server/src/db/migrations/0000_magical_misty_knight.sql` — migration iniziale
- ✅ `pnpm build` — zero errori TypeScript su tutta la monorepo
- ✅ 106 test TypeScript passano (101 in `@podcraft/shared`, 5 in `@podcraft/server`)
- ✅ DB si crea automaticamente alla prima run del server (`podcraft.db`)
- ✅ Transizioni invalide rifiutate (es. `IMPORTED → COMPLETED` → `false`)

**Note tecniche:**
- `better-sqlite3` è un addon nativo: build approvata via `pnpm.approvedBuilds` nel root `package.json`
- `*.db` aggiunto a `.gitignore`
- Segments e chapters: JSON nel DB (non normalizzati, non si fa query su singole parole)
- Ownership proposte: `edit_proposals` è legata a `analysis_results` tramite `analysis_result_id` obbligatorio; gli edit manuali utente andranno in una tabella dedicata (`user_edits`) per non mescolare output AI e modifiche umane
- ⚠️ Schema v0 non include `file_hash` / `file_last_checked_at` — aggiunti nella migration `0001_uneven_tag.sql` (Task 1.8, vedi sotto)
- ✅ Vincoli identity DB aggiunti in `0002_nervous_maverick.sql`: `UNIQUE(file_path)` + index su `file_hash`
- ✅ `apps/server/src/lib/library-reconciliation.ts` — pure reconciliation function (anticipata da Task 1.8); tests verdi
  - **Nota**: implementata qui perché isola la logica pura prima del service layer. Task 1.8 non deve riscriverla, solo usarla.

---

### Task 1.8 — Library Sync + API base ✅

**Cosa fare:**
- Backend: service `library.ts` che scansiona `RECORDINGS_DIR`:
  - Legge i file audio supportati (wav, mp3, m4a, flac, ogg)
  - Estrae metadata con FFmpeg (durata, sample rate, formato, dimensione)
  - Calcola file fingerprint: `SHA-256(primi 1 MB + file_size_bytes)` — funzione in `apps/server/src/lib/file-hash.ts`
  - **Algoritmo di riconciliazione** (in ordine di priorità):
    1. Path trovato in DB → match diretto (deterministico); se hash manca, imposta `fileHash` (retrocompat)
    2. Path non trovato + hash match su una sola entry `FILE_MISSING` → aggiorna `filePath`, transita a `IMPORTED`
    3. Path non trovato + hash match su più entry `FILE_MISSING` → caso ambiguo, non fa auto-link
    4. Nessun match → crea nuova entry `IMPORTED` con `fileHash` + `fileLastCheckedAt`
    5. DB entry non matchata → transita a `FILE_MISSING` se non era già in quel stato
- **Reconciliation pure logic già implementata** in `apps/server/src/lib/library-reconciliation.ts` (anticipata da Task 1.7). Task 1.8 la consuma senza riscriverla.
- **Retrocompat (step 1)**: quando `reconcileLibraryFiles` restituisce un `LibraryMatch` con `reason: "path"` e il recording in DB aveva `fileHash = null`, il service layer deve persistere `match.fileHash` al DB. La funzione pura restituisce già il nuovo hash — tocca al service applicarlo.
- Aggiunge le 2 colonne nullable alla migration `0001_uneven_tag.sql` (già generata da schema.ts)
- API routes:
  - `GET /api/recordings` — lista recordings con stato
  - `GET /api/recordings/:id` — dettaglio singola recording
  - `POST /api/library/sync` — triggera Library Sync manualmente (202 + esegue sync in background)
  - `POST /api/recordings/:id/transcribe` — avvia trascrizione (placeholder, ritorna 202)
  - `GET /api/files/:id/audio` — serve il file audio per il player

**Risultato:**

- ✅ `apps/server/src/config.ts` — env config con `RECORDINGS_DIR` (obbligatorio, supporta `~`), `DATABASE_URL`, `PORT`
- ✅ `apps/server/src/lib/file-hash.ts` — `computeFileHash(filePath, fileSizeBytes)`: SHA-256(first 1MB || size_LE64)
- ✅ `apps/server/src/lib/file-hash.test.ts` — 7 unit test, tutti verdi
- ✅ `apps/server/src/lib/ffprobe.ts` — `probeAudioFile(filePath)`: ffprobe CLI + Zod validation → `AudioMetadata`
- ✅ `apps/server/src/services/library.ts` — `runLibrarySync()`: scan flat dir, probe+hash, reconcile, tx DB mutations
- ✅ `apps/server/src/routes/recordings.ts` — GET /api/recordings, GET /api/recordings/:id, POST /api/recordings/:id/transcribe (placeholder 202)
- ✅ `apps/server/src/routes/library-routes.ts` — POST /api/library/sync (202, fire-and-forget)
- ✅ `apps/server/src/routes/files.ts` — GET /api/files/:id/audio (streaming + Range support)
- ✅ `apps/server/src/index.ts` — route mounting, porta da config
- ✅ 12 test TypeScript passano (7 nuovi + 5 esistenti)
- ✅ Zero errori TypeScript su tutta la monorepo

**Note tecniche:**

- `zod` aggiunto come dipendenza diretta in `apps/server` (usato in ffprobe.ts per la validazione dell'output ffprobe)
- Hash encoding: `SHA-256(firstWindowBytes || fileSizeBytes_as_8byte_LE_uint64)` — consente di distinguere file con stesso contenuto ma dimensione diversa
- Scan directory: flat (non-recursive) — per ora solo file nella root di `RECORDINGS_DIR`
- Background sync: fire-and-forget con `void promise.then/catch` — BullMQ arriva in Task 1.10
- Audio serving: Range header supportato (partial content 206) per compatibilità con `<audio>` HTML5
- Retrocompat (hash null → populate): gestita nel service layer, la funzione pura non tocca il DB

**Criterio di completamento:**
- Con file reali nella cartella, `GET /api/recordings` restituisce la lista corretta
- I metadata (durata, formato) sono precisi
- `fileHash` è popolato per ogni recording al primo sync
- Se si rinomina un file nella cartella e si triggera sync, `filePath` viene aggiornato (non creata nuova entry)
- File spariti dalla cartella → `FILE_MISSING`
- File ritrovati (con path diverso) → tornano a `IMPORTED`
- L'audio è servibile al browser via `/api/files/:id/audio`

---

### Task 1.9 — UI Library View (minima) ✅

**Cosa fare:**
- ✅ Homepage React: pagina Library che mostra la lista delle registrazioni
- ✅ Setup routing con React Router 7 (Library + RecordingDetail)
- ✅ Per ogni recording: nome, durata, formato, data, stato (badge colorato)
- ✅ Bottone "Trascrivi" (per ora chiama l'API che ritorna 202, nessun processing reale)
- ✅ Setup base: Tailwind v4 + shadcn/ui (Button, Card, Badge, Skeleton componenti)
- ✅ Audio player HTML5 base: click su una card → naviga a RecordingDetail con `<audio controls>`

**Risultato:**
- ✅ `apps/web/src/lib/api-client.ts` — Typed fetch functions con `ApiResult<T>`, Zod validation
- ✅ `apps/web/src/lib/format.ts` — Pure functions: `formatDuration`, `formatDate`, `formatFileSize`
- ✅ `apps/web/src/lib/format.test.ts` — 10 unit test, tutti verdi
- ✅ `apps/web/src/components/status-badge.tsx` — Badge con colore per ogni `RecordingStatus`
- ✅ `apps/web/src/components/recording-card.tsx` — Card con metadata + bottone Trascrivi
- ✅ `apps/web/src/pages/library-page.tsx` — Griglia recordings, auto-sync on mount, loading/error/empty states
- ✅ `apps/web/src/pages/recording-detail-page.tsx` — Detail view + audio player HTML5
- ✅ `apps/web/src/App.tsx` / `main.tsx` — React Router 7 BrowserRouter + Routes
- ✅ 10 test web passano, 145 test totali nella monorepo
- ✅ Zero errori TypeScript su tutta la monorepo

**Note tecniche:**
- Tailwind v4 via `@tailwindcss/vite` plugin (CSS-native, no `tailwind.config.js`)
- shadcn/ui via `pnpm dlx shadcn@canary init` (stile new-york, neutral, CSS variables)
- Vite proxy `/api` → `http://localhost:4000` (zero CORS, relative URLs ovunque)
- Auto-sync su mount della LibraryPage (fire-and-forget POST /api/library/sync)
- Zod validation delle response API in `api-client.ts`; `as Recording` cast necessario per compatibilità `exactOptionalPropertyTypes` vs `.nullish()` Zod
- Path alias `@/*` → `./src/*` configurato in tsconfig.json e vite.config.ts

**Criterio di completamento:**
- ✅ L'utente apre localhost:5173, vede i suoi file audio reali dalla cartella
- ✅ I metadata sono corretti e leggibili
- ✅ Click su una card permette di ascoltare l'audio
- ✅ Il layout è pulito e navigabile (non deve essere bello, deve essere chiaro)

---

### Task 1.10 — Integrazione verticale: Trascrizione E2E

**Cosa fare:**
- Collegare tutto: UI → Backend → ML Service → ritorno risultato
- Setup BullMQ + Redis:
  - Job `transcribe` che chiama ML service `/transcribe` poi `/align`
  - Al completamento, salva risultato nel DB, aggiorna stato recording
- WebSocket per progress update (anche solo stato: "in corso" → "completato")
- UI: dopo la trascrizione, la pagina recording mostra il transcript con timestamps
  - Click su un segmento di testo → l'audio salta a quel punto
  - L'audio che avanza → il testo corrispondente si evidenzia

**Criterio di completamento (la demo che chiude lo sprint):**

1. Apro localhost:5173
2. Vedo la lista dei miei file audio reali
3. Clicco "Trascrivi" su una registrazione
4. Vedo un indicatore di progresso
5. Quando finisce, vedo il transcript
6. Clicco su una frase → l'audio parte da quel punto
7. L'audio avanza → il testo si evidenzia in sync
8. Tutto in italiano, sulla mia registrazione reale

---

### Output dello Sprint 1 — Decisioni da documentare

Al termine dello sprint, compilare e aggiornare la Source of Truth:

```markdown
## Risultati Spike ML (Sprint 1)

### ASR (Qwen3-ASR)
- Modello usato: 1.7B (`mlx-community/Qwen3-ASR-1.7B-bf16`)
- Hint lingua: `language` opzionale su `/transcribe`; fallback opzionale via env `ASR_DEFAULT_LANGUAGE` (se assente usa default modello)
- Qualità transcript IT: 4/5 — comprensibile e vicina alla baseline Whisper, con qualche imprecisione lessicale
- Performance: 2.28 sec/min (warm su audio da 1 min), 3.38 sec/min (audio da 10 min), 5.66 sec/min (cold start)
- RAM picco: 3.78 GB (RSS processo ML osservato)
- Decisione: ✅ Confermato

### Alignment (Qwen3-ForcedAligner)
- Precisione timestamp: 4/5 — output coerente e monotono; verifica proxy 5/5 su prime parole
- Performance: 4.20 sec/min (1.544s su audio da 22.059s)
- RAM (delta/peak): +0.606 GB / 4.848 GB
- Decisione: ✅ Confermato

### TTS (Qwen3-TTS)
- Qualità voice clone: [1-5] + note
- Naturalezza: accettabile per podcast? sì/no
- Performance: X sec per 10s di audio
- Decisione: ✅ Confermato / 🔄 Switch a **\_\_**

### Quality (NISQA)
- Endpoint: `POST /assess-quality` implementato (finestre default 3s configurabili via API + `min_window_seconds` opzionale derivato da `window_seconds` + merge tail corto + average_mos + inference_time_seconds)
- Affidabilità scoring: 4/5 — trend coerente e discriminante su test controllato; presenti outlier raw gestiti con clamp+warning
- Soglia 3.0 ragionevole: sì (confermata per default)
- Decisione: ✅ Confermato (mantenere monitoraggio su registrazioni molto rumorose)
```

---
---

## Sprint 2 — Pipeline di Analisi (bozza)

**Obiettivo**: Dall'UI, avviare l'analisi su una recording già trascritta. Integrare Claude API per le proposte editoriali + NISQA per quality assessment. A fine sprint: l'utente vede le proposte di taglio/riordino overlay sulla waveform.

**Task previsti (da dettagliare):**
- Integrazione Claude API con prompt editoriale strutturato
- Job `quality` + job `llm-analyze` in parallelo via BullMQ
- Merge dei risultati in proposte unificate
- API per CRUD proposte (accept/reject/modify)
- UI: Wavesurfer.js con regioni colorate per i tagli proposti
- UI: Panel laterale con lista proposte e azioni
- UI: Overlay zone qualità scarsa sulla waveform

---

## Sprint 3 — Review & Editing UI (bozza)

**Obiettivo**: L'utente può interagire con le proposte: accettare, rifiutare, modificare timing, riordinare sezioni, segnalare qualità manualmente. Preview audio delle modifiche.

**Task previsti (da dettagliare):**
- Drag dei bordi regione su waveform per modificare timing
- Drag-and-drop dei blocchi transcript per riordino
- Bottone "Flag qualità" con selezione regione manuale
- Preview audio non-distruttivo (salta le sezioni tagliate in playback)
- Undo/Redo stack
- Contatore "proposte accettate / totale"

---

## Sprint 4 — TTS + Export (bozza)

**Obiettivo**: Per i segmenti di scarsa qualità, generare TTS con voice clone. Esportare l'audio finale con tutti gli edit applicati.

**Task previsti (da dettagliare):**
- UI: per segmenti flaggati qualità → bottone "Preview TTS"
- Generazione TTS con Qwen3-TTS voice clone
- Player comparativo: audio originale vs TTS
- Applicazione/rifiuto TTS per segmento
- Export pipeline: FFmpeg cuts + TTS inserts + crossfade + normalizzazione
- UI: progress export + download file finale (WAV + MP3)

---

## Sprint 5 — Polish & Settings (bozza)

**Obiettivo**: Configurazione utente, gestione errori robusti, UX polish.

**Task previsti (da dettagliare):**
- Settings page (cartella, API key, soglie, formato export)
- Error handling UI (toast notifications, retry, stati errore)
- Responsive miglioramenti
- Performance optimization (lazy loading modelli, caching)
- Keyboard shortcuts per l'editor
- Documentazione utente base

---

## Sprint 6+ — Evoluzione (bozza)

- Video generation con Remotion
- Speaker diarization
- Batch processing
- Traduzione e doppiaggio
- Integrazione piattaforme (RSS, Spotify, YouTube)
