# PodCraft — Backlog

> Task opzionali, idee fuori sprint, e feature interessanti non ancora pianificate.
> Queste non bloccano il MVP ma vale la pena tracciarle per non perderle.
> Quando un item viene incluso in uno sprint, spostarlo nel file sprint corrispondente.

---

## Infrastruttura & DevX

### Tracciamento dipendenze di sistema

**Problema**: Redis e ffmpeg sono dipendenze di sistema non tracciate in nessun file versionato. Cambiando macchina, vanno reinstallate manualmente senza riferimenti.

**Stato attuale (febbraio 2026):**

| Tool      | Installato? | Come?                    | Tracciato? |
| --------- | ----------- | ------------------------ | ---------- |
| Node.js   | ✅          | asdf                     | ✅ `.tool-versions` |
| Python    | ✅          | uv                       | ✅ `services/ml/.python-version` |
| uv        | ✅          | curl → `~/.local/bin/uv` | ❌ |
| ffmpeg    | ✅          | brew                     | ❌ |
| redis     | ✅          | brew                     | ❌ |
| asdf      | ✅          | brew                     | ❌ |

**Soluzione proposta:**

1. **`Brewfile`** alla root:
   ```ruby
   brew "asdf"    # version manager Node (usato da .tool-versions)
   brew "ffmpeg"  # ffprobe usato da apps/server/src/lib/ffprobe.ts
   brew "redis"   # richiesto da BullMQ
   brew "uv"      # Python package manager per services/ml/
   ```
   Uso: `brew bundle` per installare tutto.

2. Sezione "Prerequisites" nel README (quando verrà creato):
   ```
   brew bundle
   asdf plugin add nodejs && asdf install
   npm install -g pnpm
   pnpm install
   pnpm run download-models
   ```

**Criterio di completamento:** `brew bundle check` dalla root → tutto verde.

---

## Performance & Scalabilità

### WebWorker per rendering waveform

Wavesurfer.js fa il decoding dell'audio nel main thread. Per file audio lunghi (>30 min) questo può bloccare la UI. Un approccio con OffscreenCanvas + WebWorker renderebbe il rendering non-bloccante.

**Impatto**: Sprint 3-4, dopo che Wavesurfer è stabile.

### Chunking audio per trascrizione >20 min

L'architettura menziona chunking con VAD (Voice Activity Detection) per audio >20 min. Attualmente non implementato — il ML service riceve l'audio intero. Per file molto lunghi (>45 min) il processing time potrebbe essere problematico.

**Soluzione**: split con `ffmpeg -f segment` prima di inviare al ML service; merge dei risultati nel `transcription-pipeline.ts`.

### Cache risposte LLM

Per la stessa trascrizione, ri-analizzare costa ~$0.03-0.10 (dipende dalla lunghezza). Una cache basata su hash del transcript eviterebbe chiamate duplicate.

**Implementazione**: Redis cache con key `llm:${transcriptHash}`, TTL 24h.

---

## ML & AI

### Offline LLM analysis

Alternativa a Claude API per analisi completamente offline. Modelli candidati: `mlx-community/Qwen3-8B-bf16` o simile, con prompt ottimizzato per structured output.

**Compromessi**: qualità analisi editoriale significativamente inferiore; richiede prompt engineering intensivo.

### Speaker diarization

Identificazione automatica di chi parla, utile per interviste e dialoghi. Librerie candidate: `pyannote-audio` (richiede token HuggingFace), `whisperx` (include diarization).

**Quando**: Sprint 6+. Richiede riprogettazione del data model (ogni segment ha `speakerId`).

---

## UX & Features

### Keyboard shortcuts per l'editor

Scorciatoie per operazioni frequenti durante la review:

| Shortcut | Azione |
| -------- | ------ |
| `Space`  | Play/Pause |
| `A`      | Accetta proposta corrente |
| `R`      | Rifiuta proposta corrente |
| `Tab`    | Prossima proposta |
| `Shift+Tab` | Proposta precedente |
| `J/K`    | Seek ±5 secondi |
| `Ctrl+Z` | Undo |

**Impatto**: Sprint 5 (polish). Migliora drasticamente la velocità di review.

### Esportazione parziale (preview)

Prima di esportare l'intero file, permettere di ascoltare in preview come suonerà con gli edit applicati. Il backend esegue FFmpeg con i tagli selezionati e serve il risultato come stream.

**Nota**: questo è "preview audio non-distruttivo" già pianificato in Sprint 3.

### Modalità "auto-accept" per high-confidence cuts

Un toggle che accetta automaticamente tutte le proposte con `confidence > 0.9`. Utile per utenti esperti che si fidano dell'AI.

**Complessità**: bassa (frontend only, toggle + filter).

### Multi-language UI

L'app nasce con UI in italiano ma il codice dovrebbe supportare i18n. Libreria candidata: `react-i18next`.

**Quando**: post-MVP, Sprint 5+.

### Dark mode

La palette shadcn/ui supporta dark mode nativamente (CSS variables). Serve solo aggiungere il toggle e le classi dark.

**Complessità**: bassa. Può essere aggiunto in qualsiasi sprint.

---

## Sviluppi Futuri (Sprint 6+)

*Vedi anche `docs/sprint-plan.md` sezione Sprint 6+.*

### Video generation con Remotion

Composizioni React che producono video con waveform animata, sottotitoli sincronizzati, testo animato. I componenti React del frontend sono riusabili come base.

### Batch processing

Processare una serie di episodi con settings condivisi (stessa voice reference, stessa soglia qualità, stesso prompt LLM). UI: queue visibile con progress multipli.

### Traduzione e doppiaggio

1. Transcript → traduzione automatica (Claude API o modello locale)
2. TTS nella lingua target con voice clone (stessa voce dell'originale)
3. Lip sync / timing adjustment

### Integrazione piattaforme

- Generazione RSS feed per podcast
- Upload diretto a Spotify/Apple Podcasts/YouTube
- Sincronizzazione metadati (titolo, descrizione, capitoli)

### Plugin system

API pubblica per estensioni community: nuovi tipi di analisi, nuovi formati di export, nuovi provider AI.
