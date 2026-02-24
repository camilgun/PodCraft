# PodCraft — Sprint Plan Overview

> Questo file è una mappa ad alto livello. I dettagli di ogni sprint vivono nei file dedicati.
> Sprint completati → archivio in `sprint-N.md`. Sprint corrente → `sprint-2.md`.
>
> Gli sprint futuri (3+) sono bozze: verranno dettagliati uno alla volta,
> alla luce dei risultati dello sprint precedente.

---

## Sprint 1 — Spike Tecnico + Fondamenta ✅ COMPLETATO

**Obiettivo**: Validare lo stack ML su M4 Max, scheletro monorepo, pipeline trascrizione E2E.

**Output**: Monorepo funzionante, ML Service con ASR+Align+TTS+NISQA, UI Library View, trascrizione E2E con transcript sincronizzato all'audio.

**Dettaglio completo**: [`docs/sprint-1.md`](sprint-1.md)

---

## Sprint 2 — Pipeline di Analisi ⚙️ CORRENTE

**Obiettivo**: Dall'UI, avviare l'analisi su una recording trascritta. Claude API per proposte editoriali + NISQA per quality assessment. L'utente vede le proposte overlay sulla waveform interattiva.

**Task**:
- 2.1 — WebSocket real-time progress
- 2.2 — Quality Assessment Job (NISQA via BullMQ)
- 2.3 — LLM Analysis Job (Claude Sonnet 4.6)
- 2.4 — Analysis Pipeline (orchestrazione parallela + merge + routes)
- 2.5 — Wavesurfer.js player (sostituisce `<audio>`)
- 2.6 — Analysis trigger UI + Zustand store
- 2.7 — Proposals Panel + Waveform overlays

**Dettaglio completo**: [`docs/sprint-2.md`](sprint-2.md)

---

## Sprint 3 — Review & Editing UI (bozza)

**Obiettivo**: L'utente può interagire con le proposte in modo avanzato: modificare i timing, riordinare sezioni, flaggare qualità manualmente, preview audio non-distruttivo, undo/redo.

**Task previsti (da dettagliare):**

- Drag dei bordi regione su waveform per modificare timing (update `userStartTime`/`userEndTime`)
- Drag-and-drop dei blocchi transcript per riordino sezioni
- Bottone "Flag qualità manuale" con selezione regione sulla waveform
- Preview audio non-distruttivo (playback che salta le sezioni tagliate)
- Undo/Redo stack (Zustand + history pattern)
- Miglioramento AnalysisResult: ri-analisi parziale dopo modifiche pesanti

---

## Sprint 4 — TTS + Export (bozza)

**Obiettivo**: Per i segmenti di scarsa qualità, generare TTS con voice clone. Esportare l'audio finale con tutti gli edit applicati.

**Task previsti (da dettagliare):**

- UI: per segmenti `tts_replace` → pulsante "Preview TTS" funzionante
- Generazione TTS con Qwen3-TTS voice clone (voice sample da 3s registrazione)
- Player comparativo: audio originale vs TTS generato
- Applicazione/rifiuto TTS per segmento
- Export job FFmpeg: tagli + inserzioni TTS + crossfade + normalizzazione loudness
- UI: progress export + download file finale (WAV + MP3)

---

## Sprint 5 — Polish & Settings (bozza)

**Obiettivo**: Configurazione utente, error handling robusto, UX polish.

**Task previsti (da dettagliare):**

- Settings page: `RECORDINGS_DIR`, `CLAUDE_API_KEY`, soglia qualità, formato export, lingua default
- Error handling UI: toast notifications, retry da errore, stati errore chiari per ogni step
- Responsive miglioramenti (layout editor su schermi diversi)
- Performance: lazy loading modelli ML, caching risposte LLM
- Keyboard shortcuts per l'editor (play/pause, accept/reject, navigate proposals)
- README utente (setup, prerequisiti, utilizzo)

---

## Sprint 6+ — Evoluzione (bozza)

**Obiettivo**: Feature avanzate post-MVP.

- Video generation con Remotion (waveform animata, sottotitoli, testo)
- Speaker diarization (identificazione automatica speaker per interviste)
- Batch processing (processare serie di episodi con settings condivisi)
- Traduzione e doppiaggio (transcript → traduzione → TTS in lingua target)
- Integrazione piattaforme (RSS feed, upload Spotify/Apple/YouTube)
- Plugin system per estensioni community

**Idee e feature opzionali non assegnate a sprint**: [`docs/backlog.md`](backlog.md)
