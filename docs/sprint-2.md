# Sprint 2 — Pipeline di Analisi (CORRENTE)

**Obiettivo**: Dall'UI, avviare l'analisi su una recording già trascritta. Integrare Claude API per le proposte editoriali + NISQA per quality assessment. A fine sprint: l'utente vede le proposte di taglio/riordino overlay sulla waveform interattiva.

**Stato iniziale**: Recording in stato TRANSCRIBED, transcript visibile e navigabile.

**Stato finale**: Recording in stato REVIEWED, waveform interattiva con regioni colorate, panel proposte accept/reject.

**Branch naming**: `task/2.X-slug-breve` (es. `task/2.1a-ws-backend`, `task/2.1b-ws-frontend`, `task/2.3-llm-job`)

---

## Task 2.1A — WebSocket foundation (shared + backend)

**Obiettivo**: Preparare l'infrastruttura WebSocket lato shared/backend, così i job delle task successive (2.2, 2.3) possono broadcastare progresso real-time.

**Prerequisiti**: nessuno (task indipendente).

**Cosa fare:**

- Aggiungere `@hono/node-ws` come dipendenza di `apps/server`
- `packages/shared/src/types.ts` — aggiungere tipi WS (export da `index.ts`):

```typescript
type WsEventType = 'progress' | 'state_change' | 'completed' | 'failed'

interface WsProgressEvent {
  type: WsEventType
  recordingId: string
  step?: string        // 'transcribing' | 'aligning' | 'quality' | 'llm_analyze' | 'merging'
  percent?: number     // 0-100
  message?: string
  newState?: RecordingStatus
  error?: string
}
```

- Aggiungere `WsProgressEventSchema` in `packages/shared/src/schemas.ts`
- `apps/server/src/services/ws.ts` — singleton `WsManager`:
  - `connect(recordingId: string, ws: WSContext): void`
  - `disconnect(recordingId: string, ws: WSContext): void`
  - `broadcast(recordingId: string, event: WsProgressEvent): void` — invia a tutti i client connessi per quel recording
  - Internamente: `Map<string, Set<WSContext>>` (recordingId → set di client)
- Route `GET /api/recordings/:id/ws` — WebSocket upgrade (in `apps/server/src/routes/ws-routes.ts`)
- `apps/server/src/index.ts` — monta ws-routes + injectWebSocket
- `apps/server/src/jobs/worker.ts` — aggiornare per emettere eventi WS al cambio di stato del job transcription:
  - Job active → `broadcast(recordingId, { type: 'progress', step: 'transcribing', percent: 0 })`
  - Job completed → `broadcast(recordingId, { type: 'state_change', newState: 'TRANSCRIBED' })`
  - Job failed → `broadcast(recordingId, { type: 'failed', error: message })`

**File da creare/modificare:**

```
apps/server/src/services/ws.ts                    (nuovo)
apps/server/src/routes/ws-routes.ts               (nuovo)
packages/shared/src/types.ts                      (modifica: aggiunge WsProgressEvent)
packages/shared/src/schemas.ts                    (modifica: aggiunge WsProgressEventSchema)
apps/server/src/index.ts                          (modifica: monta ws-routes + injectWebSocket)
apps/server/src/jobs/worker.ts                    (modifica: emette eventi WS)
```

**Criterio di completamento:**

- `WsManager` unit test (`ws.test.ts`): connect/disconnect/broadcast/isolamento per recordingId (5+ test)
- WebSocket si connette e riceve eventi quando si avvia una trascrizione (test manuale con client WS)
- Zero errori TypeScript

---

## Task 2.1B — WebSocket hook + integrazione pagina recording

**Obiettivo**: Usare l'infrastruttura WS in frontend per aggiornare la UI in real-time e tenere il polling come fallback.

**Prerequisiti**: Task 2.1A.

**Cosa fare:**

- `apps/web/src/hooks/use-recording-ws.ts` — hook che apre WS:
  - Connette a `ws://localhost:4000/api/recordings/:id/ws` (adatta se HTTP diverso)
  - Ritorna `{ lastEvent: WsProgressEvent | null, isConnected: boolean }`
  - Gestisce cleanup su unmount (chiude la connessione)
  - Reconnect automatico fino a 3 tentativi con backoff (1s, 2s, 4s)
- `apps/web/src/pages/recording-detail-page.tsx` — usare WS:
  - `useRecordingWs(id)` per ricevere eventi real-time
  - Se `lastEvent.type === 'state_change'` → refetch recording (come faceva il poller)
  - Mantenere `useRecordingPoller` come fallback se WS non disponibile (già implementato)

**File da creare/modificare:**

```
apps/web/src/hooks/use-recording-ws.ts            (nuovo)
apps/web/src/pages/recording-detail-page.tsx      (modifica: usa useRecordingWs)
```

**Criterio di completamento:**

- Quando la trascrizione finisce, il frontend aggiorna senza polling
- `use-recording-ws.test.ts`: test con WebSocket mockato (connessione/disconnessione/messaggi)
- Zero errori TypeScript

---

## Task 2.2 — Quality Assessment Job (backend)

**Obiettivo**: Job BullMQ che chiama NISQA via ML Service, salva i quality scores nel DB, e notifica il progresso via WebSocket.

**Prerequisiti**: Task 2.1A (WsManager disponibile per broadcast). Può essere implementato senza WS (omettendo i broadcast) ma il WS è preferibile.

**Cosa fare:**

- `apps/server/src/lib/ml-client.ts` — aggiungere `mlAssessQuality()`:

```typescript
interface QualityAssessmentOptions {
  windowSeconds?: number
  minWindowSeconds?: number
}

async function mlAssessQuality(
  audioFilePath: string,
  options?: QualityAssessmentOptions
): Promise<QualityAssessmentResponse>
```

  - `POST /assess-quality` (multipart): campo `file` + campi opzionali `window_seconds`, `min_window_seconds`
  - Zod validation della response (schema già in `packages/shared/src/schemas.ts`)
  - Usa `node-fetch` o Node native `fetch` + `FormData` (stesso pattern di `mlTranscribe`/`mlAlign`)

- `apps/server/src/jobs/quality.job.ts` — BullMQ job `quality`:

```typescript
interface QualityJobData {
  recordingId: string
  windowSeconds?: number
  minWindowSeconds?: number
}
```

  - Step 1: legge recording da DB, verifica che il file esista su disco (`fs.existsSync`)
  - Step 2: broadcast WS `{ type: 'progress', step: 'quality', percent: 0 }`
  - Step 3: chiama `mlAssessQuality(recording.filePath, options)`
  - Step 4: DB transaction idempotente:
    - `DELETE FROM quality_scores WHERE recording_id = ?`
    - `INSERT INTO quality_scores` per ogni window
    - `flagged = mos < QUALITY_THRESHOLD_DEFAULT`, `flaggedBy = 'auto'`
  - Step 5: broadcast WS `{ type: 'progress', step: 'quality', percent: 100 }`
  - **Non** aggiorna `recording.status` (gestito dalla pipeline in Task 2.4)
  - In caso di errore: broadcast WS `{ type: 'failed', error: message }` + rilancia

- Registrare `quality` processor nel worker esistente (`apps/server/src/jobs/worker.ts`)

**File da creare/modificare:**

```
apps/server/src/lib/ml-client.ts                  (modifica: aggiunge mlAssessQuality)
apps/server/src/jobs/quality.job.ts               (nuovo)
apps/server/src/jobs/worker.ts                    (modifica: registra quality processor)
```

**Test da scrivere:**

- `apps/server/src/lib/ml-client.test.ts` — aggiungere test per `mlAssessQuality()`:
  - Happy path: response validata e ritornata correttamente
  - Response invalida → ZodError
- `apps/server/src/jobs/quality.job.test.ts`:
  - Happy path: N quality windows salvate nel DB
  - Idempotenza: rieseguire non duplica i dati (DELETE + INSERT)
  - MOS < 3.0 → `flagged: true, flaggedBy: 'auto'`
  - File non trovato → errore esplicito

**Criterio di completamento:**

- Il job esegue correttamente su una recording reale (end-to-end se ML Service è attivo)
- Test passano tutti con ml-client mockato
- Zero errori TypeScript
- Tutti i test pre-esistenti restano verdi (278+)

---

## Task 2.3 — LLM Analysis Job (Claude API)

**Obiettivo**: Job BullMQ che invia il transcript a Claude Sonnet 4.6, valida l'output strutturato con Zod, e salva `AnalysisResult` + `EditProposal[]` nel DB.

**Prerequisiti**: Task 2.1A (WsManager). Può essere implementato senza WS.

**Cosa fare:**

- Aggiungere `@anthropic-ai/sdk` come dipendenza di `apps/server`
- `apps/server/src/config.ts` — aggiungere `claudeApiKey: string` (env `CLAUDE_API_KEY`, obbligatorio)
- `.env.example` — aggiungere `CLAUDE_API_KEY=sk-ant-...`
- `apps/server/src/services/llm.ts`:

```typescript
async function analyzeTranscript(
  transcript: Transcription,
  recording: Recording
): Promise<AnalysisResult>
```

  - Usa `@anthropic-ai/sdk` con `claude-sonnet-4-6`
  - System prompt: definisce il ruolo di editor editoriale (vedi struttura sotto)
  - User prompt: invia transcript con timestamps segmenti + metadata recording
  - Richiede output JSON che rispetti `AnalysisResult` schema
  - Zod validation dell'output: se fallisce, ritenta 1x con nota di correzione nel prompt
  - Se fallisce anche al secondo tentativo: throw con `Error('LLM output validation failed')`

**Struttura prompt (linee guida):**

```
SYSTEM:
Sei un editor editoriale esperto per podcast e contenuti YouTube.
Analizzi trascrizioni audio e fornisci feedback strutturato in JSON.
Il tuo obiettivo è aiutare il creator a risparmiare tempo di editing
senza stravolgere il suo stile e contenuto.
Rispondi SOLO con JSON valido, nessun testo aggiuntivo.

USER:
Registrazione: {titolo file}, {durata formattata}, lingua: {lingua}

Transcript (segmenti con timestamp):
[00:00] Testo segmento 1
[00:15] Testo segmento 2
...

Analizza questo contenuto e restituisci un oggetto JSON con:
- summary: string (max 200 parole)
- suggestedTitle: string
- chapters: array di { title, startTime, endTime }
- editorialNotes: string (osservazioni generali)
- proposals: array di EditProposal (vedi schema sotto)

Schema EditProposal:
{
  type: "cut" | "reorder" | "tts_replace",
  subtype: "filler" | "repetition" | "off_topic" | "low_energy" | "tangent" | null,
  startTime: number (secondi),
  endTime: number (secondi),
  originalText: string,
  reason: string (breve motivazione),
  confidence: number (0-1),
  proposedPosition: number | null (solo per type="reorder")
}
```

- `apps/server/src/jobs/llm-analyze.job.ts` — BullMQ job `llm-analyze`:

```typescript
interface LlmAnalyzeJobData {
  recordingId: string
}
```

  - Step 1: legge recording + transcription da DB; se transcription non trovata → errore
  - Step 2: broadcast WS `{ type: 'progress', step: 'llm_analyze', percent: 0 }`
  - Step 3: chiama `analyzeTranscript(transcript, recording)`
  - Step 4: broadcast WS `{ type: 'progress', step: 'llm_analyze', percent: 80 }`
  - Step 5: DB transaction idempotente:
    - `DELETE FROM edit_proposals WHERE analysis_result_id IN (SELECT id FROM analysis_results WHERE recording_id = ?)`
    - `DELETE FROM analysis_results WHERE recording_id = ?`
    - `INSERT INTO analysis_results` (summary, suggestedTitle, chapters JSON, editorialNotes)
    - `INSERT INTO edit_proposals[]` (ogni proposta con `analysis_result_id` FK, `status = 'proposed'`)
  - Step 6: broadcast WS `{ type: 'progress', step: 'llm_analyze', percent: 100 }`
  - **Non** aggiorna `recording.status`

- Registrare `llm-analyze` processor nel worker

**File da creare/modificare:**

```
apps/server/src/services/llm.ts                   (nuovo)
apps/server/src/jobs/llm-analyze.job.ts           (nuovo)
apps/server/src/config.ts                         (modifica: aggiunge claudeApiKey)
apps/server/src/jobs/worker.ts                    (modifica: registra llm-analyze processor)
.env.example                                       (modifica: aggiunge CLAUDE_API_KEY)
```

**Test da scrivere:**

- `apps/server/src/services/llm.test.ts`:
  - Happy path: Anthropic SDK mockato → output JSON valido → AnalysisResult ritornato
  - Output JSON invalido → retry → successo al secondo tentativo
  - Output JSON invalido → retry → fallimento → Error thrown
- `apps/server/src/jobs/llm-analyze.job.test.ts`:
  - Happy path: AnalysisResult + EditProposal[] salvati nel DB
  - Idempotenza: rieseguire non duplica i dati
  - Transcription non trovata → errore esplicito

**Criterio di completamento:**

- `llm.ts` produce un `AnalysisResult` validato con Zod a partire da una response mockata
- Job idempotente e testato
- `CLAUDE_API_KEY` documentata in `.env.example`
- Zero `any`, zero `@ts-ignore`
- Tutti i test pre-esistenti restano verdi

---

## Task 2.4 — Analysis Pipeline: orchestrazione + merge + routes

**Obiettivo**: Collegare i job 2.2 e 2.3 in una pipeline parallela. Aggiungere la logica di merge. Esporre le API routes per analisi e proposte.

**Prerequisiti**: Task 2.2, Task 2.3.

**Cosa fare:**

### Analysis Pipeline

- `apps/server/src/services/analysis-pipeline.ts` — `runAnalysisPipeline(recordingId: string)`:
  1. Verifica recording in stato TRANSCRIBED (se no → `Error('Recording not in TRANSCRIBED state')`)
  2. Transita recording → ANALYZING (DB update)
  3. Broadcast WS `{ type: 'state_change', newState: 'ANALYZING' }`
  4. Enqueue job `quality` + job `llm-analyze` in parallelo (stessa BullMQ queue)
  5. Attende entrambi con `Promise.allSettled()` (non fallisce al primo errore)
  6. Se entrambi completati → chiama `mergeAnalysisResults(recordingId)`
  7. Transita recording → REVIEWED
  8. Broadcast WS `{ type: 'state_change', newState: 'REVIEWED' }`
  9. Se uno o entrambi falliti → transita recording → ERROR con `errorMessage` aggregato

### Merge Logic (modulo puro)

- `apps/server/src/lib/analysis-merge.ts` — `mergeAnalysisResults(recordingId, proposals, qualityScores)`:
  - **Input puro** (no DB calls): prende `EditProposal[]` + `QualityScore[]`
  - **Regola 1**: per ogni quality window flaggata (`flagged: true`), se esiste già una proposta `cut` che contiene interamente quel range → non creare proposta `tts_replace` (il taglio ha priorità)
  - **Regola 2**: per ogni quality window flaggata senza `cut` overlap → crea una nuova `EditProposal` di tipo `tts_replace`, `subtype: 'low_energy'`, con `reason: 'Zona qualità audio scarsa (MOS: X.XX)'`
  - **Output**: array di nuove proposte `tts_replace` da persistere nel DB
  - La funzione è pura: no side effects, testabile in isolamento

### API Routes (`apps/server/src/routes/analysis-routes.ts`)

- `POST /api/recordings/:id/analyze`:
  - Legge recording; se non TRANSCRIBED → 409 Conflict con messaggio chiaro
  - Fire-and-forget `runAnalysisPipeline()` in background
  - Risponde 202 Accepted

- `GET /api/recordings/:id/analysis`:
  - Query 1: `analysis_results WHERE recording_id = ?`
  - Query 2: `edit_proposals WHERE analysis_result_id = ?`
  - Query 3: `quality_scores WHERE recording_id = ?`
  - Assembla e ritorna `{ analysisResult, proposals, qualityScores }`
  - 404 se `analysis_results` non trovato

- `GET /api/recordings/:id/quality-scores`:
  - Ritorna `quality_scores[]` per la recording
  - 404 se nessun score trovato

- `PATCH /api/recordings/:id/proposals/:proposalId`:
  - Body Zod schema:
    ```typescript
    { status: 'accepted' | 'rejected' | 'modified', userStartTime?: number, userEndTime?: number }
    ```
  - Aggiorna `edit_proposals` nel DB
  - 404 se proposta non trovata

- Aggiungere in `packages/shared/src/schemas.ts`:
  - `analysisDetailResponseSchema` — shape di GET /analysis
  - `updateProposalBodySchema` — body di PATCH /proposals/:id

**File da creare/modificare:**

```
apps/server/src/services/analysis-pipeline.ts    (nuovo)
apps/server/src/lib/analysis-merge.ts            (nuovo — puro)
apps/server/src/lib/analysis-merge.test.ts       (nuovo)
apps/server/src/routes/analysis-routes.ts        (nuovo)
apps/server/src/index.ts                         (modifica: monta analysis-routes)
packages/shared/src/schemas.ts                   (modifica: aggiunge nuovi schemas)
```

**Test da scrivere:**

- `analysis-merge.test.ts` (puro, no mock DB):
  - Cut che contiene quality window → nessuna proposta tts_replace generata
  - Quality window senza cut overlap → proposta tts_replace generata
  - Overlap parziale (cut non contiene interamente) → tts_replace generata
  - Più quality windows flaggate → una proposta tts_replace per ognuna senza overlap
  - Nessuna quality window flaggata → nessuna proposta generata
- `analysis-pipeline.test.ts` con job mockati

**Criterio di completamento:**

- `POST /analyze` triggera entrambi i job, recording passa a ANALYZING
- Dopo completamento: recording è REVIEWED, analysis_result + proposals in DB
- `GET /analysis` assembla correttamente da 3 query separate
- `PATCH /proposals/:id` aggiorna lo status
- `analysis-merge.test.ts`: almeno 5 test tutti verdi
- Zero errori TypeScript

---

## Task 2.5 — Wavesurfer.js player

**Obiettivo**: Sostituire il player HTML5 `<audio>` con Wavesurfer.js 7. La waveform interattiva è il core dell'editor (Sprint 2+).

**Prerequisiti**: nessuno (task frontend indipendente).

**Cosa fare:**

- `pnpm add wavesurfer.js` in `apps/web`
- `apps/web/src/components/waveform/waveform-player.tsx` — React component:
  - Crea l'istanza Wavesurfer in un `useEffect` con cleanup corretto (`wavesurfer.destroy()`)
  - Props:
    ```typescript
    interface WaveformPlayerProps {
      audioUrl: string
      onReady?: (duration: number) => void
      onTimeUpdate?: (currentTime: number) => void
      onSeek?: (time: number) => void
      className?: string
    }
    ```
  - Espone ref imperativo tramite `useImperativeHandle`:
    ```typescript
    interface WaveformPlayerRef {
      play(): void
      pause(): void
      seekTo(seconds: number): void
      getCurrentTime(): number
    }
    ```
  - Waveform color: usa CSS custom properties (`--waveform-color`, `--waveform-progress-color`)
  - **Non** includere il Regions plugin in questo task (arriva in 2.7)

- `apps/web/src/components/waveform/player-controls.tsx`:
  - Play/Pause button (usa shadcn/ui Button)
  - Seek bar (input range HTML o shadcn/ui Slider)
  - Current time / total time (usa `formatDuration` da `lib/format.ts`)
  - Zoom slider (min: 1, max: 10, default: 1)

- Aggiornare `apps/web/src/pages/recording-detail-page.tsx`:
  - Sostituire `<audio>` con `<WaveformPlayer ref={waveformRef}>` + `<PlayerControls>`
  - Mantenere sync con `TranscriptViewer`: il seek del player aggiorna il transcript, e viceversa
  - Rimuovere il riferimento a `<audio>` HTML5

**Note per i test (jsdom non supporta canvas):**

Mock di Wavesurfer in `vitest.setup.ts` o nel file di test:
```typescript
vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn(() => ({
      on: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
      getCurrentTime: vi.fn(() => 0),
      getDuration: vi.fn(() => 100),
      destroy: vi.fn(),
      zoom: vi.fn(),
    }))
  }
}))
```

**File da creare/modificare:**

```
apps/web/src/components/waveform/waveform-player.tsx   (nuovo)
apps/web/src/components/waveform/player-controls.tsx   (nuovo)
apps/web/src/pages/recording-detail-page.tsx           (modifica: sostituisce <audio>)
```

**Criterio di completamento:**

- Waveform visibile e interattiva in RecordingDetail
- Play/Pause/Seek funzionano
- Sync con TranscriptViewer intatta (click segmento → seek, audio avanza → highlight)
- `waveform-player.test.tsx` e `player-controls.test.tsx` con Wavesurfer mockato (smoke + callbacks)
- Zero errori TypeScript

---

## Task 2.6 — Analysis trigger UI + Zustand store

**Obiettivo**: UI per avviare l'analisi, monitorare il progresso via WebSocket, e gestire il flusso da TRANSCRIBED → ANALYZING → REVIEWED. Introduzione di Zustand per lo stato dell'analisi.

**Prerequisiti**: Task 2.4 (routes), Task 2.5 (waveform player). Task 2.1B (WS hook frontend) preferibile.

**Cosa fare:**

- `pnpm add zustand` in `apps/web`

- `apps/web/src/stores/analysis-store.ts` — Zustand store:
```typescript
interface AnalysisState {
  analysis: AnalysisResult | null
  proposals: EditProposal[]
  qualityScores: QualityScore[]
  isLoading: boolean
  // actions
  setAnalysisData(data: { analysis: AnalysisResult; proposals: EditProposal[]; qualityScores: QualityScore[] }): void
  updateProposalStatus(id: string, status: EditProposal['status'], timing?: { userStartTime?: number; userEndTime?: number }): void
  clearAnalysis(): void
}
```

- `apps/web/src/lib/api-client.ts` — aggiungere:
  - `triggerAnalysis(recordingId: string): Promise<ApiResult<void>>`
  - `getAnalysis(recordingId: string): Promise<ApiResult<AnalysisDetailResponse>>`
  - `updateProposal(recordingId: string, proposalId: string, update: UpdateProposalBody): Promise<ApiResult<void>>`
  - `getQualityScores(recordingId: string): Promise<ApiResult<QualityScore[]>>`

- `apps/web/src/pages/recording-detail-page.tsx` — aggiornare per gestire tutti gli stati:

  **Stato TRANSCRIBED:**
  - Mostrare pulsante "Analizza" (shadcn Button, variante primary)
  - Click → `triggerAnalysis(id)` → refetch recording → UI passa a ANALYZING (ottimisticamente)

  **Stato ANALYZING:**
  - Mostrare progress bar (shadcn Progress)
  - Usare `useRecordingWs` per ricevere eventi: `step` + `percent`
  - Messaggi: "Analisi qualità audio..." / "Analisi editoriale (Claude)..." / "Finalizzazione..."
  - Se WS non disponibile: polling 2s (già implementato, usarlo come fallback)

  **Stato REVIEWED:**
  - Caricare analysis con `getAnalysis(id)` → popola Zustand store
  - Renderizzare layout a 3 pannelli: `[Waveform full-width top]` + `[Transcript | ProposalsPanel bottom]`
  - Il ProposalsPanel viene implementato nella prossima task (2.7): placeholder per ora

- Se `useRecordingWs` non ancora implementato (Task 2.1B non completato): implementarlo qui con un approccio semplificato (no reconnect) e aggiornare in seguito.

**File da creare/modificare:**

```
apps/web/src/stores/analysis-store.ts                  (nuovo)
apps/web/src/lib/api-client.ts                         (modifica: nuove funzioni)
apps/web/src/pages/recording-detail-page.tsx           (modifica: gestione stati analysis)
apps/web/src/hooks/use-recording-ws.ts                 (nuovo se non già in Task 2.1B)
```

**Test da scrivere:**

- `analysis-store.test.ts`: unit test dello store Zustand
  - `setAnalysisData` popola correttamente
  - `updateProposalStatus` aggiorna la proposta corretta senza mutare le altre
  - `clearAnalysis` resetta tutto
- `recording-detail-page.test.tsx` — aggiornare per testare tutti gli stati:
  - TRANSCRIBED: mostra pulsante "Analizza"
  - ANALYZING: mostra progress bar
  - REVIEWED: mostra layout editor (con ProposalsPanel placeholder)

**Criterio di completamento:**

- L'utente vede "Analizza" quando TRANSCRIBED, progress quando ANALYZING, layout editor quando REVIEWED
- Il Zustand store contiene l'analysis data e può essere aggiornato (per Task 2.7)
- Zero errori TypeScript, tutti i test verdi

---

## Task 2.7 — Proposals Panel + Waveform overlays

**Obiettivo**: UI completa di review: panel laterale con proposte accept/reject e regioni colorate sulla waveform.

**Prerequisiti**: Task 2.5 (Wavesurfer), Task 2.6 (Zustand store + layout REVIEWED).

**Cosa fare:**

### Proposals Panel

- `apps/web/src/components/proposals/proposals-panel.tsx`:
  - Legge proposte da `useAnalysisStore`
  - Filtri in cima: `Tutte | Da revisionare | Accettate | Rifiutate` (shadcn Tabs)
  - Sommario: "N tagli · M riordini · K TTS replace · Tempo risparmiato: ~Xm"
    - Stima tempo: somma durate delle proposte `cut` accettate
  - Per ogni proposta (shadcn Card):
    - Icon + tipo: ✂️ Taglio / 🔄 Riordino / 🔊 TTS Replace
    - Range temporale: `MM:SS → MM:SS`
    - Testo originale (troncato a ~100 chars, espandibile)
    - Motivazione in italico
    - Confidence badge (verde > 0.8, giallo 0.5-0.8, rosso < 0.5)
    - Azioni:
      - `proposed` → [✅ Accetta] [❌ Rifiuta]
      - `accepted` → [↩️ Annulla] (torna a proposed)
      - `rejected` → [↩️ Annulla] (torna a proposed)
    - Per `tts_replace`: mostrare pulsante extra `🔊 Preview TTS` (disabled in Sprint 2, tooltip "Disponibile in Sprint 4")
    - Per `cut`: mostrare opzione `✏️ Modifica timing` (apre inline mini-form con due input secondi — opzionale per Sprint 2)
  - Click su proposta → `waveformRef.current.seekTo(proposal.startTime)` + scroll waveform

- Azioni di accept/reject:
  - Chiamano `updateProposal()` in `api-client.ts`
  - On success: `useAnalysisStore.updateProposalStatus()` (ottimistico)
  - On error: rollback + toast di errore (shadcn Toast)

### Waveform Regions

- `apps/web/src/components/waveform/waveform-regions.tsx` — HOC o hook che estende `WaveformPlayer`:
  - Aggiunge Wavesurfer **Regions plugin** (`wavesurfer.js/dist/plugins/regions`)
  - Renderizza una regione per ogni proposta con colore per tipo:
    ```
    cut:         rgba(239, 68, 68, 0.3)   // red-500 semitrasparente
    reorder:     rgba(59, 130, 246, 0.3)  // blue-500 semitrasparente
    tts_replace: rgba(249, 115, 22, 0.3)  // orange-500 semitrasparente
    ```
  - Regioni quality score flaggato: `rgba(239, 68, 68, 0.15)` (tenue, sotto le proposte)
  - Proposte `rejected`: stessa regione con opacity ridotta (0.1)
  - Proposte `accepted`: bordo solid + opacity piena (marker visivo)
  - Click regione → `onRegionClick(proposalId)` → panel scrolla alla proposta + highlight

- Aggiornare `recording-detail-page.tsx`:
  - Passare proposals + qualityScores a `WaveformRegions`
  - Quando utente accetta/rifiuta in panel → aggiornare le regioni visivamente (via store → re-render)
  - Contatore footer: "N/M proposte revisionate"

**Palette colori regioni (valori esatti):**

```
cut (proposed):       rgba(239, 68,  68,  0.30)
cut (accepted):       rgba(239, 68,  68,  0.60)  + border 2px solid
cut (rejected):       rgba(239, 68,  68,  0.10)
reorder (proposed):   rgba(59,  130, 246, 0.30)
reorder (accepted):   rgba(59,  130, 246, 0.60)  + border 2px solid
reorder (rejected):   rgba(59,  130, 246, 0.10)
tts_replace:          rgba(249, 115, 22,  0.30)
quality_low:          rgba(239, 68,  68,  0.12)  (sotto tutte le altre)
```

**File da creare/modificare:**

```
apps/web/src/components/proposals/proposals-panel.tsx    (nuovo)
apps/web/src/components/waveform/waveform-regions.tsx    (nuovo)
apps/web/src/pages/recording-detail-page.tsx             (modifica: integra panel + regioni)
```

**Test da scrivere:**

- `proposals-panel.test.tsx`:
  - Renderizza proposte da store
  - Click accetta → `updateProposal` chiamato + store aggiornato
  - Click rifiuta → `updateProposal` chiamato + store aggiornato
  - Filtri: "Da revisionare" mostra solo `proposed`
  - Sommario: stima tempo corretta (somma durate cut accettati)
- `waveform-regions.test.tsx` con Wavesurfer mockato:
  - Smoke test: component renderizza senza errori
  - Regions plugin chiamato con i colori corretti per tipo

**Criterio di completamento:**

- Panel mostra tutte le proposte con azioni funzionanti
- Regioni colorate visibili sulla waveform
- Click proposta in panel → seek waveform
- Click regione → scroll panel alla proposta
- Accept/Reject in panel → regione aggiorna colore/opacity
- Contatore "N/M proposte revisionate" accurato
- Zero errori TypeScript, tutti i test verdi

---

## Criteri di chiusura Sprint 2

La demo che chiude lo sprint:

1. Apro localhost:5173, vedo la lista registrazioni
2. Clicco su una registrazione già trascritta (TRANSCRIBED)
3. Vedo la waveform Wavesurfer (non più `<audio>`)
4. Clicco "Analizza" → recording passa a ANALYZING
5. Vedo progress real-time via WebSocket (step quality + step LLM)
6. Quando finisce: recording è REVIEWED, vedo le regioni colorate sulla waveform
7. Vedo il panel laterale con le proposte editoriali
8. Clicco "Accetta" su un taglio → la regione diventa più opaca con bordo
9. Clicco "Rifiuta" su un altro → la regione si fa quasi trasparente
10. Click su una regione waveform → il panel scrolla alla proposta corrispondente
11. Zone qualità scarsa visibili come overlay tenue rosso

**Test count target:** 350+ test totali (da 278)
