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

### Task 1.2 — Setup ML Service Python

**Cosa fare:**
- Creare `services/ml/` con FastAPI
- `pyproject.toml` con dipendenze: `fastapi`, `uvicorn`, `mlx-audio`, `pydantic`
- Endpoint health check `GET /health`
- Script `scripts/download-models.sh` che scarica i modelli MLX da HuggingFace:
  - `mlx-community/Qwen3-ASR-0.6B-8bit` (usiamo il piccolo per lo spike, poi si scala)
  - `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`
  - `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16`
- Configurare Turborepo per includere il ML service nel comando `pnpm dev`

**Nota sui modelli per lo spike**: partiamo con i modelli 0.6B per velocità di download e test. Se la qualità è sufficiente, rimaniamo su quelli. Se no, si scala a 1.7B (il Mac li regge).

**Criterio di completamento:**
- `python -m uvicorn app.main:app` avvia il servizio su localhost:5000
- I modelli sono scaricati nella cache locale
- `GET /health` risponde con modelli disponibili

---

### Task 1.3 — Spike ASR: trascrivere una registrazione reale

**Cosa fare:**
- Implementare `POST /transcribe` nel ML service:
  - Accetta un file audio (multipart)
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
- [ ] Il transcript italiano è comprensibile e accurato?
- [ ] I filler words (ehm, allora, cioè) vengono trascritti?
- [ ] Tempo di inference per 1 min di audio: _____ secondi
- [ ] Tempo di inference per 10 min di audio: _____ secondi
- [ ] RAM picco durante inference: _____ GB
- [ ] Errori o crash? Descrizione: _____

**Decisione da prendere dopo il test:**
- ✅ Qualità OK → si conferma Qwen3-ASR, si procede
- ⚠️ Qualità mediocre → si testa il modello 1.7B
- ❌ Qualità scarsa o crash → si testa Whisper-large-v3-turbo via mlx-audio come fallback

---

### Task 1.4 — Spike Alignment: timestamps word-level

**Cosa fare:**
- Implementare `POST /align` nel ML service:
  - Accetta audio + testo (dal task 1.3)
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
- [ ] I timestamp sono accurati? (ascoltare audio a timestamp X, coincide con la parola?)
- [ ] Funziona con il testo italiano prodotto da Qwen3-ASR?
- [ ] Tempo di inference: _____ secondi
- [ ] RAM aggiuntiva: _____ GB

**Decisione:**
- ✅ Preciso → si conferma
- ❌ Impreciso → si valuta WhisperX come alternativa per l'alignment

---

### Task 1.5 — Spike TTS: voice clone

**Cosa fare:**
- Implementare `POST /synthesize` nel ML service:
  - Accetta: `{ text, reference_audio (3s clip), language }`
  - Qwen3-TTS genera audio con voce clonata
  - Restituisce il file audio WAV
- Testare: estrarre 3 secondi dalla registrazione reale, clonare la voce, generare una frase nuova
- Confronto A/B: ascoltare la voce originale vs TTS clonato

**Cosa valutare:**
- [ ] La voce clonata è riconoscibile come la stessa persona?
- [ ] La naturalezza è accettabile per un podcast?
- [ ] Artefatti audio evidenti?
- [ ] Tempo di generazione per 10 secondi di audio: _____ secondi
- [ ] RAM aggiuntiva: _____ GB

**Decisione:**
- ✅ Accettabile → si conferma locale
- ⚠️ Mediocre → si implementa switch a Qwen3-TTS API (cloud, qualità migliore)
- ❌ Scarso → si implementa switch a ElevenLabs API

---

### Task 1.6 — Spike Quality Assessment: NISQA

**Cosa fare:**
- Implementare `POST /assess-quality` nel ML service:
  - Accetta audio
  - NISQA analizza e restituisce scores
  - Per audio lungo: analisi a finestre di 5 secondi
- Testare con un audio di buona qualità e uno con problemi noti (rumore, distorsione)

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
- [ ] I punteggi MOS riflettono la qualità percepita?
- [ ] Le zone rumorose hanno MOS significativamente più basso?
- [ ] La soglia 3.0 sembra ragionevole come default?

---

### Task 1.7 — Database e tipi fondamentali

**Cosa fare:**
- Definire tutti i tipi in `packages/shared` (TypeScript + Zod):
  - `Recording`, `RecordingStatus`, `Transcription`, `AlignedSegment`, `AlignedWord`, `QualityScore`, `EditProposal`
  - Zod schemas corrispondenti per validazione runtime
  - State machine: funzione `canTransition(from, to): boolean`
- Setup Drizzle ORM + SQLite in `apps/server`:
  - Schema DB che rispecchia i tipi
  - Migration iniziale
  - Seed script con dati di test

**Criterio di completamento:**
- I tipi sono importabili sia dal frontend che dal backend
- `pnpm test` nel package shared passa con copertura >90%
- Il DB si crea automaticamente alla prima run del server
- Le transizioni di stato invalide vengono rifiettate dalla state machine

---

### Task 1.8 — Library Sync + API base

**Cosa fare:**
- Backend: service `library.ts` che scansiona `RECORDINGS_DIR`:
  - Legge i file audio supportati (wav, mp3, m4a, flac, ogg)
  - Estrae metadata con FFmpeg (durata, sample rate, formato, dimensione)
  - Sync con DB: nuovi file → `IMPORTED`, file spariti → flaggati
- API routes:
  - `GET /api/recordings` — lista recordings con stato
  - `GET /api/recordings/:id` — dettaglio singola recording
  - `POST /api/recordings/:id/transcribe` — avvia trascrizione (placeholder, ritorna 202)
  - `GET /api/files/:id/audio` — serve il file audio per il player

**Criterio di completamento:**
- Con file reali nella cartella, `GET /api/recordings` restituisce la lista corretta
- I metadata (durata, formato) sono precisi
- L'audio è servibile al browser via `/api/files/:id/audio`

---

### Task 1.9 — UI Library View (minima)

**Cosa fare:**
- Homepage React: pagina Library che mostra la lista delle registrazioni
- Setup routing con React Router 7 (Library + RecordingDetail)
- Per ogni recording: nome, durata, formato, data, stato (badge colorato)
- Bottone "Trascrivi" (per ora chiama l'API che ritorna 202, nessun processing reale)
- Setup base: Tailwind + shadcn/ui (Button, Card, Badge componenti)
- Audio player HTML5 base: click su una card → si sente l'audio

**Criterio di completamento:**
- L'utente apre localhost:5173, vede i suoi file audio reali dalla cartella
- I metadata sono corretti e leggibili
- Click su una card permette di ascoltare l'audio
- Il layout è pulito e navigabile (non deve essere bello, deve essere chiaro)

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
- Modello usato: 0.6B / 1.7B
- Qualità transcript IT: [1-5] + note
- Performance: X sec per min di audio
- RAM picco: X GB
- Decisione: ✅ Confermato / 🔄 Switch a ______

### Alignment (Qwen3-ForcedAligner)
- Precisione timestamp: [1-5] + note
- Performance: X sec per min di audio
- Decisione: ✅ Confermato / 🔄 Switch a ______

### TTS (Qwen3-TTS)
- Qualità voice clone: [1-5] + note
- Naturalezza: accettabile per podcast? sì/no
- Performance: X sec per 10s di audio
- Decisione: ✅ Confermato / 🔄 Switch a ______

### Quality (NISQA)
- Affidabilità scoring: [1-5] + note
- Soglia 3.0 ragionevole: sì/no, suggerita: ______
- Decisione: ✅ Confermato / 🔄 Switch a ______
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
