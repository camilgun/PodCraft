# PodCraft — Architecture & Product Spec (Source of Truth)

> Questo documento è la sorgente di verità per lo sviluppo di PodCraft.
> Ogni sprint e task derivano da qui. Gli agenti di sviluppo lo usano come contesto primario.

---

## 1. Product Vision

### Cos'è PodCraft
PodCraft è un tool web per content creator che trasforma registrazioni audio grezze in contenuti podcast/YouTube pronti per la pubblicazione. L'AI trascrive, analizza la qualità, propone tagli intelligenti (filler, ripetizioni, tangenti), suggerisce riorganizzazioni, e può rigenerare con TTS le sezioni di scarsa qualità audio — il tutto con un'interfaccia in cui il creator mantiene il controllo finale.

### Per chi è
- Creator che registrano monologhi, pensieri, lezioni, interviste
- Che vogliono ridurre drasticamente il tempo di post-produzione audio
- Che non hanno competenze di editing audio professionale
- Multilingua: il tool nasce con supporto italiano ma è progettato per essere globale (10+ lingue)

### Cosa NON è
- Non è un DAW (Audacity, Logic Pro) — non si edita la waveform a mano
- Non è un generatore di contenuti — il contenuto è sempre dell'utente
- Non è un servizio cloud — gira localmente sul Mac dell'utente (tranne la chiamata Claude API per l'analisi editoriale)

### Flusso utente (user journey)

```
1. L'utente apre PodCraft nel browser (localhost)
2. Vede la libreria: lista delle sue registrazioni audio da una cartella configurata
3. Seleziona una registrazione → vede i dettagli (durata, formato, data)
4. Avvia la trascrizione → progresso visibile in real-time
5. Trascrizione completata → vede il transcript sincronizzato con l'audio
6. Avvia l'analisi AI → l'AI valuta qualità audio e propone editing
7. Analisi completata → vede le proposte sovrapposte alla waveform/transcript:
   - Tagli suggeriti (filler, ripetizioni, off-topic) con motivazione
   - Riorganizzazioni suggerite con motivazione
   - Segmenti con qualità audio scarsa flaggati (auto + manuali)
8. L'utente revisiona: accetta, rifiuta, o modifica ogni proposta
   - Può segnalare manualmente altre zone di scarsa qualità
   - Per le zone flaggate: può richiedere TTS con la sua voce clonata,
     fare preview della versione TTS, oppure decidere di ri-registrare
   - Può riordinare sezioni con drag-and-drop
   - Preview audio delle modifiche in tempo reale
9. Soddisfatto → esporta l'audio finale (WAV lossless + MP3)
```

### Valore chiave
| Senza PodCraft | Con PodCraft |
|---|---|
| 1h di registrazione = 3-4h di editing manuale | 1h di registrazione = 15-30min di review |
| Servono competenze di editing audio | Basta saper ascoltare e cliccare accetta/rifiuta |
| La riorganizzazione è mentalmente faticosa | L'AI propone un ordine narrativo migliore |
| Le sezioni con audio scarso si tengono o si tagliano | Si possono rigenerare con la propria voce (TTS clone) |

---

## 2. Stack Tecnologico

### Architettura ad alto livello

```
┌──────────────────────────────────────────────────────────────┐
│                    FRONTEND (Vite + React 19)                 │
│        TypeScript · Tailwind · React Router · Wavesurfer.js  │
└──────────────────────────┬───────────────────────────────────┘
                           │ REST + WebSocket (progresso real-time)
┌──────────────────────────▼───────────────────────────────────┐
│                  BACKEND (Node.js + Hono)                     │
│       BullMQ (job queue) · Drizzle ORM · SQLite               │
│                    TypeScript strict                           │
└───────┬──────────────┬─────────────────┬─────────────────────┘
        │              │                 │
   ┌────▼────┐   ┌─────▼──────┐   ┌─────▼──────┐
   │ ML Svc  │   │ Claude API │   │  FFmpeg     │
   │ Python  │   │ (Sonnet)   │   │  (audio     │
   │ FastAPI │   │  Remoto    │   │  processing)│
   │ Locale  │   │            │   │  Locale     │
   └─────────┘   └────────────┘   └────────────┘
```

### Scelte e motivazioni (sintesi)

| Componente | Scelta | Motivazione in 1 riga |
|---|---|---|
| Frontend | Vite + React 19 | SPA locale, zero bisogno di SSR; meno magia = meno errori agenti |
| Testing | Vitest | Nativo con Vite, velocissimo, stessa API di Jest |
| UI Components | Tailwind + shadcn/ui | Velocità di sviluppo, agent-friendly (componenti ben documentati) |
| Routing | React Router 7 | SPA routing, semplice e maturo |
| Audio Waveform | Wavesurfer.js 7 | Waveform interattiva con regioni, markers, zoom, plugin spectrogram |
| State | Zustand | Leggero, type-safe, semplice da testare |
| Backend HTTP | Hono | TypeScript-first, ultraleggero, Web Standard APIs |
| Job Queue | BullMQ + Redis | Retry automatici, concurrency control, monitoring dashboard |
| Database | SQLite + Drizzle ORM | Zero-config locale; Drizzle dà type-safety e migrazioni facili |
| Audio Processing | FFmpeg (via fluent-ffmpeg) | Standard industriale per tagli, concat, fade, normalizzazione |
| Monorepo | Turborepo | Setup semplice, caching intelligente dei build |

### Modelli AI

**Locali su Apple M4 Max (36 GB) — tutti via MLX (mlx-audio), tutti bf16:**

| Modello | Repo ID | Task | Size | RAM stimata |
|---|---|---|---|---|
| Qwen3-ASR-1.7B-bf16 | `mlx-community/Qwen3-ASR-1.7B-bf16` | Speech-to-Text (52 lingue) | ~4.08 GB | ~4.5 GB |
| Qwen3-ForcedAligner-0.6B-bf16 | `mlx-community/Qwen3-ForcedAligner-0.6B-bf16` | Timestamps word-level (11 lingue) | ~1.84 GB | ~2.5 GB |
| Qwen3-TTS-12Hz-1.7B-Base-bf16 | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` | TTS + Voice Clone (10 lingue, 3s sample) | ~4.54 GB | ~5 GB |
| NISQA v2.0 | `torchmetrics` (auto-download) | Audio Quality Score (MOS 1-5, non-intrusivo) | ~50 MB | ~0.5 GB |

Totale picco: ~12.5 GB. I modelli vengono caricati on-demand (lazy loading). Tutti bf16 per massima qualità.

**Remoto:**

| Servizio | Task | Motivazione |
|---|---|---|
| Claude Sonnet 4.5 API | Analisi editoriale, proposta tagli, riorganizzazione | Richiede reasoning complesso che nessun modello locale eguaglia |

### Tradeoff noti da monitorare

| Tradeoff | Rischio | Mitigazione |
|---|---|---|
| Qwen3-ASR è recentissimo (Jan 2026) | Ecosistema meno maturo di Whisper, possibili bug | Fallback a Whisper-large-v3 via mlx-audio; interfaccia `ASRProvider` astratta |
| Qwen3-TTS su MLX è in maturazione | Qualità potenzialmente inferiore alla versione CUDA | Interfaccia `TTSProvider` con switch a API Qwen3-TTS o ElevenLabs |
| Claude API = dipendenza remota + costo | Offline non funziona l'analisi; ~$3/M tokens | L'analisi è asincrona, non blocca il flusso; cache dei risultati |
| NISQA non è perfetto su tutti i tipi di audio | Potrebbe non flaggare tutto correttamente | Segnalazione manuale sempre disponibile come complemento |

---

## 3. Recording State Machine

Ogni registrazione nella libreria ha uno stato preciso. Questo guida sia l'UI (cosa mostrare, quali azioni sono disponibili) sia il backend (quali job lanciare).

```
                          ┌──────────┐
           file trovato   │          │
           nella cartella │ IMPORTED │
                          │          │
                          └────┬─────┘
                               │ utente clicca "Trascrivi"
                          ┌────▼──────────┐
                          │               │
                          │ TRANSCRIBING  │  ← progresso visibile
                          │               │
                          └────┬──────────┘
                               │ completato
                          ┌────▼──────────┐
                          │               │
                          │ TRANSCRIBED   │  ← transcript visibile e navigabile
                          │               │     l'utente può già ascoltare + leggere
                          └────┬──────────┘
                               │ utente clicca "Analizza"
                          ┌────▼──────────┐
                          │               │
                          │  ANALYZING    │  ← quality + LLM in parallelo
                          │               │
                          └────┬──────────┘
                               │ completato
                          ┌────▼──────────┐
                          │               │
                          │  REVIEWED     │  ← proposte visibili, utente revisiona
                          │               │
                          └────┬──────────┘
                               │ utente clicca "Esporta"
                          ┌────▼──────────┐
                          │               │
                          │  EXPORTING    │  ← FFmpeg + eventuale TTS
                          │               │
                          └────┬──────────┘
                               │ completato
                          ┌────▼──────────┐
                          │               │
                          │  COMPLETED    │  ← file scaricabile
                          │               │
                          └──────────────┘

    Qualsiasi stato può andare a → ERROR (con messaggio)
    Da ERROR l'utente può → Riprovare (torna allo stato precedente)
    Da TRANSCRIBED l'utente può → ri-trascrivere (torna a TRANSCRIBING)
    Da REVIEWED l'utente può → ri-analizzare (torna a ANALYZING)
```

**Azioni disponibili per stato:**

| Stato | Cosa vede l'utente | Azioni disponibili |
|---|---|---|
| IMPORTED | Card con nome file, durata, formato, data | Trascrivi, Elimina dalla libreria |
| TRANSCRIBING | Progress bar / percentuale | Annulla |
| TRANSCRIBED | Transcript sincronizzato + player audio | Analizza, Ri-trascrivi, Esplora transcript |
| ANALYZING | Spinner/progresso | Annulla |
| REVIEWED | Waveform + transcript + proposte di editing overlay | Accetta/Rifiuta proposte, Modifica timing, Flag qualità, Riordina, Preview, Esporta, Ri-analizza |
| EXPORTING | Progress bar rendering | Annulla |
| COMPLETED | Link download + player preview | Scarica WAV, Scarica MP3, Torna a Review |
| ERROR | Messaggio errore dettagliato | Riprova |

---

## 4. Data Structures (contratti tra moduli)

Queste strutture sono definite nel package `shared` in TypeScript (Zod) e rispecchiate in Python (Pydantic) nel ML service.

### Recording

```typescript
interface Recording {
  id: string;
  filePath: string;
  originalFilename: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  format: string;            // wav, mp3, m4a, flac, ogg
  fileSizeBytes: number;
  status: RecordingStatus;
  languageDetected?: string; // populated after ASR
  createdAt: string;         // ISO 8601
  updatedAt: string;
}

type RecordingStatus =
  | 'IMPORTED'
  | 'TRANSCRIBING'
  | 'TRANSCRIBED'
  | 'ANALYZING'
  | 'REVIEWED'
  | 'EXPORTING'
  | 'COMPLETED'
  | 'ERROR';
```

### Transcription & Alignment

```typescript
interface Transcription {
  id: string;
  recordingId: string;
  fullText: string;
  segments: AlignedSegment[];
  modelUsed: string;
  languageDetected: string;
  createdAt: string;
}

interface AlignedSegment {
  id: string;
  text: string;
  startTime: number;   // secondi (float)
  endTime: number;
  orderIndex: number;
  words: AlignedWord[];
}

interface AlignedWord {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;  // 0-1
}
```

### Quality Assessment

```typescript
interface QualityScore {
  id: string;
  recordingId: string;
  windowStart: number;
  windowEnd: number;
  mos: number;           // 1.0 - 5.0 (overall quality)
  noisiness: number;     // 1.0 - 5.0
  discontinuity: number;
  coloration: number;
  loudness: number;
  flagged: boolean;
  flaggedBy: 'auto' | 'user';
}
```

### Edit Proposals (output LLM)

```typescript
interface AnalysisResult {
  recordingId: string;
  summary: string;
  suggestedTitle: string;
  chapters: Chapter[];
  editorialNotes: string;
  proposals: EditProposal[];
}

interface EditProposal {
  id: string;
  type: 'cut' | 'reorder' | 'tts_replace';
  subtype?: 'filler' | 'repetition' | 'off_topic' | 'low_energy' | 'tangent';
  startTime: number;
  endTime: number;
  originalText: string;
  reason: string;
  confidence: number;     // 0-1
  proposedPosition?: number;  // solo per reorder
  status: 'proposed' | 'accepted' | 'rejected' | 'modified';
  // campi per modifiche utente
  userStartTime?: number;
  userEndTime?: number;
}

interface Chapter {
  title: string;
  startTime: number;
  endTime: number;
}
```

---

## 5. Struttura del Progetto (Monorepo)

```
podcraft/
├── package.json                  # workspace root
├── pnpm-workspace.yaml           # workspace discovery per pnpm
├── turbo.json                    # Turborepo config
├── tsconfig.base.json
├── .tool-versions                # runtime Node (asdf)
├── .env.example                  # CLAUDE_API_KEY, RECORDINGS_DIR, etc.
│
├── apps/
│   ├── web/                      # Vite + React 19 frontend (SPA)
│   │   ├── src/
│   │   │   ├── pages/            # Route pages
│   │   │   │   ├── Library.tsx         # Lista recordings
│   │   │   │   └── RecordingDetail.tsx # Editor view
│   │   │   ├── components/
│   │   │   │   ├── library/      # Cards recordings, filtri, stati
│   │   │   │   ├── waveform/     # Wavesurfer.js editor + regioni
│   │   │   │   ├── transcript/   # Transcript sincronizzato
│   │   │   │   ├── proposals/    # Panel proposte con accept/reject
│   │   │   │   ├── player/       # Audio player controls
│   │   │   │   └── export/       # Export dialog + download
│   │   │   ├── hooks/
│   │   │   ├── stores/           # Zustand stores
│   │   │   └── lib/              # API client, utils
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   │
│   └── server/                   # Backend Node.js (Hono)
│       ├── src/
│       │   ├── index.ts          # Entry point: Hono app + WebSocket
│       │   ├── routes/
│       │   │   ├── recordings.ts # CRUD recordings + stato
│       │   │   ├── transcriptions.ts
│       │   │   ├── analysis.ts
│       │   │   ├── proposals.ts  # Accept/reject/modify
│       │   │   ├── export.ts
│       │   │   └── files.ts      # Serve audio files
│       │   ├── services/
│       │   │   ├── library.ts    # Scan cartella, sync con DB
│       │   │   ├── pipeline.ts   # Orchestrazione step
│       │   │   ├── ml-client.ts  # HTTP client → ML Service
│       │   │   ├── llm.ts        # Claude API + prompt templates
│       │   │   ├── audio.ts      # FFmpeg wrapper
│       │   │   └── ws.ts         # WebSocket per progress updates
│       │   ├── jobs/             # BullMQ job processors
│       │   │   ├── transcribe.job.ts
│       │   │   ├── align.job.ts
│       │   │   ├── quality.job.ts
│       │   │   ├── llm-analyze.job.ts
│       │   │   └── export.job.ts
│       │   ├── db/
│       │   │   ├── schema.ts     # Drizzle schema
│       │   │   └── migrations/
│       │   └── lib/
│       │       ├── errors.ts     # Error types tipizzati
│       │       └── logger.ts     # Structured logging
│       └── package.json
│
├── packages/
│   └── shared/                   # Tipi e validazioni condivisi
│       ├── src/
│       │   ├── types.ts          # Tutte le interfacce TypeScript
│       │   ├── schemas.ts        # Zod schemas (runtime validation)
│       │   ├── stateMachine.ts   # Recording state transitions
│       │   └── constants.ts      # Soglie, config defaults
│       └── package.json
│
├── services/
│   └── ml/                       # Python ML Service (FastAPI, uv)
│       ├── app/
│       │   ├── main.py           # FastAPI app + health check
│       │   ├── config.py         # pydantic-settings config
│       │   ├── schemas.py        # Pydantic schemas (mirror di Zod)
│       │   ├── routers/
│       │   │   ├── asr.py        # POST /transcribe
│       │   │   ├── align.py      # POST /align
│       │   │   ├── tts.py        # POST /synthesize
│       │   │   └── quality.py    # POST /assess-quality
│       │   └── models/           # Model loading & inference wrappers
│       │       ├── base.py       # Provider interfaces
│       │       ├── asr_model.py
│       │       ├── aligner_model.py
│       │       ├── tts_model.py
│       │       └── quality_model.py
│       ├── pyproject.toml
│       ├── package.json          # Turborepo integration wrapper
│       ├── .python-version       # Python 3.11 pin per uv
│       └── tests/
│
└── scripts/
    └── download-models.sh        # Scarica pesi MLX da HuggingFace
    # Dev orchestration: usare `pnpm dev` (gestito da Turborepo)
```

---

## 6. UI — Schermate Principali

### 6.1 Library View (homepage)

La schermata principale mostra tutte le registrazioni trovate nella cartella configurata.

```
┌─────────────────────────────────────────────────────────────────┐
│  PodCraft                     📁 /Users/.../registrazioni  ⚙️   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Filtri: [Tutti ▼]  [Ordina per: Data ▼]        🔄 Aggiorna    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🎙️ registrazione_2026-02-10.m4a                        │  │
│  │  12:35 · M4A · 10 feb 2026 · Italiano                   │  │
│  │  ✅ COMPLETED                         [Apri] [Scarica ▼] │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🎙️ pensieri_AI_tools.wav                                │  │
│  │  24:12 · WAV · 8 feb 2026                                │  │
│  │  📝 TRANSCRIBED                    [Apri] [▶ Analizza]   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🎙️ intervista_marco.mp3                                 │  │
│  │  45:03 · MP3 · 5 feb 2026                                │  │
│  │  📥 IMPORTED                       [Apri] [▶ Trascrivi]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🎙️ lezione_vue3.m4a                                     │  │
│  │  1:02:15 · M4A · 1 feb 2026                              │  │
│  │  ⏳ ANALYZING (67%)                              [Apri]   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Recording Detail — Editor View

Quando l'utente clicca "Apri" su una registrazione in stato REVIEWED.

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Libreria    registrazione_2026-02-10.m4a    [⚙️] [Esporta ▼]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  WAVEFORM + OVERLAY                       │  │
│  │                                                           │  │
│  │  ═══╪▓▓▓▓╪════════╪═══════════╪▓▓▓▓▓▓╪═══════════════   │  │
│  │      cut1          ↕reorder    cut2                      │  │
│  │  ___🔴🔴🔴___                                            │  │
│  │   low quality                                             │  │
│  │                                                           │  │
│  │  [⏮] [▶ Play] [⏭]  ──●────────────────  2:15 / 12:35   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌────────────────────────┬─────────────────────────────────┐  │
│  │                        │                                 │  │
│  │    TRANSCRIPT          │    PROPOSTE AI                  │  │
│  │    (sincronizzato)     │                                 │  │
│  │                        │  📊 Riepilogo                   │  │
│  │  [0:00] ▓ Allora ehm  │  5 tagli · 1 riordino · 2 TTS  │  │
│  │  oggi volevo parlare   │  Tempo risparmiato: ~2:30       │  │
│  │  di una cosa...        │                                 │  │
│  │                        │  ─────────────────────────      │  │
│  │  [0:15] Il tema che    │                                 │  │
│  │  mi sta a cuore è      │  ✂️ Taglio #1 — Filler          │  │
│  │  l'intelligenza...     │  0:00 → 0:08                    │  │
│  │                        │  "Allora ehm oggi volevo..."    │  │
│  │  [0:45] 🔴 E poi ho   │  [✅ Accetta] [❌ Rifiuta]      │  │
│  │  notato che quando     │  [✏️ Modifica timing]           │  │
│  │  si parla di...        │                                 │  │
│  │                        │  🔊 TTS Replace — Qualità audio │  │
│  │  [2:10] Un altro       │  0:45 → 0:52                    │  │
│  │  aspetto fondamentale  │  MOS: 2.1 (sotto soglia 3.0)   │  │
│  │  è che...              │  [🔊 Preview TTS] [✅ Applica]  │  │
│  │                        │  [🚫 Ignora] [🎤 Ri-registra]  │  │
│  │                        │                                 │  │
│  │  [Flag qualità 🚩]    │  🔄 Riordino #1                 │  │
│  │                        │  Sposta §3 prima di §2          │  │
│  │                        │  "Migliore flow narrativo"      │  │
│  │                        │  [✅ Accetta] [❌ Rifiuta]      │  │
│  │                        │                                 │  │
│  └────────────────────────┴─────────────────────────────────┘  │
│                                                                 │
│  [Undo] [Redo]         Proposte: 3/5 accettate                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Processing Pipeline (dettaglio tecnico)

Pipeline asincrona gestita da BullMQ. Ogni step è un job separato.

### Step 1 — Library Sync
- All'avvio (e periodicamente), il server scansiona `RECORDINGS_DIR`
- Nuovi file → creati in DB con stato `IMPORTED`
- File rimossi → marcati (soft delete, mai rimossi dal DB)
- File modificati → rilevati via hash/mtime

### Step 2 — Transcription (trigger: utente)
- Job `transcribe`: invia audio a ML Service → Qwen3-ASR-1.7B
- Per audio > 20 min: chunking con VAD prima dell'invio
- Output: testo completo + language detection
- Progresso inviato via WebSocket al frontend
- Stato → `TRANSCRIBING` → `TRANSCRIBED`

### Step 3 — Forced Alignment (automatico dopo Step 2)
- Job `align`: invia audio + testo a ML Service → Qwen3-ForcedAligner-0.6B
- Output: timestamps word-level per ogni segmento
- Si concatena con la trascrizione (non è un step separato lato utente)

### Step 4 — Analysis (trigger: utente)
Due job in parallelo:

**4a — Quality Assessment**
- Job `quality`: invia audio a ML Service → NISQA v2.0
- Analisi a finestre di 5 secondi (configurabile)
- Segmenti con MOS < 3.0 → flaggati come `LOW_QUALITY`

**4b — LLM Editorial Analysis**
- Job `llm-analyze`: invia transcript completo a Claude Sonnet 4.5
- Prompt strutturato che richiede output JSON validato con Zod
- Claude analizza: contenuto interessante, filler, ripetizioni, struttura narrativa, riorganizzazioni
- Output: `AnalysisResult` (vedi sezione 4)

### Step 5 — Merge & Present
- Combina quality scores + LLM proposals
- Cross-reference: se un segmento è sia low-quality che tagliato → priorità al taglio
- Se un segmento è low-quality ma non tagliato → proposta TTS replace
- Stato → `ANALYZED` → `REVIEWED`

### Step 6 — Export (trigger: utente)
- Job `export`: esegue le edit accettate
- FFmpeg: tagli non-distruttivi, crossfade, normalizzazione loudness
- Per segmenti TTS: genera audio con Qwen3-TTS (voice clone da 3s sample della registrazione)
- Crossfade automatico ai bordi delle inserzioni TTS
- Output: WAV + MP3
- Stato → `EXPORTING` → `COMPLETED`

---

## 8. Configurazione e Settings

```typescript
interface AppConfig {
  recordingsDir: string;     // default: ~/registrazioni
  claudeApiKey: string;
  qualityThreshold: number;  // MOS soglia (default: 3.0)
  defaultLanguage: string;   // per hint ASR (default: 'it')
  ttsProvider: 'local' | 'api';  // default: 'local'
  exportFormats: ('wav' | 'mp3')[];
  exportMp3Bitrate: number;  // default: 192
}
```

L'utente può configurare via UI (Settings page) o `.env` file.

---

## 9. Safety Net per Sviluppo Agent-Driven

Queste pratiche sono vincolanti per tutto lo sviluppo:

| Pratica | Dettaglio |
|---|---|
| TypeScript `strict: true` | In tutti i package TS. Zero `any`. |
| Zod schemas per tutti i confini | Ogni API request/response validata runtime. Ogni output ML validato. |
| Pydantic in Python | Mirror dei Zod schemas per il ML service. |
| Error types espliciti | Mai throw generico; tipi `Result<T, E>` dove possibile. |
| Structured logging | Ogni job logga: `{ jobId, recordingId, step, status, duration, error? }` |
| Test per ogni job | Ogni BullMQ job ha unit test con mock del ML service. |
| Integration test pipeline | Test E2E che verifica il flusso completo con un audio di test. |
| Idempotenza | Ogni job può essere rieseguito senza side-effect; controlla lo stato prima di agire. |
| DB migrations versioniate | Ogni cambio schema passa per una migration Drizzle tracciata. |

---

## 10. Sviluppi Futuri (post-MVP)

In ordine di priorità stimata:

1. **Video generation con Remotion** — Composizioni React che producono video con waveform, sottotitoli, testo animato. I componenti del frontend sono riusabili.
2. **Speaker diarization** — Identificazione automatica di chi parla (per interviste/dialoghi).
3. **Traduzione e doppiaggio** — Traduzione del transcript + TTS nella lingua target.
4. **Batch processing** — Processare una serie di episodi con settings condivisi.
5. **Integrazione piattaforme** — Generazione RSS feed, upload diretto a Spotify/Apple Podcasts/YouTube.
6. **Plugin system** — Estensioni community per nuovi tipi di analisi o formati.
