import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Audio to timed words, through Mistral's transcription API.
 *
 * WHY WORD TIMESTAMPS AND NOT SEGMENTS. The same endpoint returns either.
 * Segments are whole sentences, sometimes seven seconds of speech in one
 * block, which is not a subtitle and cannot be turned into one without
 * guessing where inside those seven seconds each phrase was spoken. Words come
 * with their own start and end, so `lib/cues.mjs` can group them by what reads
 * well and every cue still starts on the word it shows. One request either
 * way, same price.
 *
 * REPLACING THIS FILE IS THE SUPPORTED WAY TO CHANGE TRANSCRIBER. Everything
 * downstream consumes `{ text, start, end }[]`. whisper.cpp, faster-whisper,
 * Deepgram and AssemblyAI all produce word timings in some shape; map them to
 * that array and nothing else in the pipeline changes. See AGENTS.md.
 */

const ENDPOINT = process.env.MISTRAL_API_URL ?? 'https://api.mistral.ai/v1/audio/transcriptions';

/**
 * @param {{file:string,offset:number}[]} chunks
 * @returns {Promise<{words:{text:string,start:number,end:number}[],language:string|null}>}
 */
export async function transcribe(chunks, { model, language, log = () => {} } = {}) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key || key === 'your-key-here') {
    throw new Error(
      'MISTRAL_API_KEY is not set. Copy .env.example to .env and put your key in it. ' +
        'Get one at https://console.mistral.ai',
    );
  }

  const words = [];
  let detected = null;

  for (const [index, chunk] of chunks.entries()) {
    if (chunks.length > 1) log(`chunk ${index + 1}/${chunks.length} (from ${chunk.offset.toFixed(0)}s)`);

    const form = new FormData();
    form.append(
      'file',
      new Blob([readFileSync(chunk.file)], { type: 'audio/mpeg' }),
      path.basename(chunk.file),
    );
    form.append('model', model ?? process.env.MISTRAL_MODEL ?? 'voxtral-mini-latest');
    form.append('timestamp_granularities', 'word');
    /* Optional. Given, it stops the model guessing; guessed wrong on a short
       clip, the transcript comes back in the wrong language entirely. */
    if (language) form.append('language', language);

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    const body = await response.json();
    if (!response.ok) {
      const message = typeof body?.message === 'string' ? body.message : JSON.stringify(body);
      throw new Error(`Mistral returned ${response.status}: ${message}`);
    }

    detected ??= body.language ?? null;

    /*
     * The word list arrives under `segments`, one entry per word, because the
     * response shape is the same whichever granularity was asked for. Do not
     * read `body.words`: it is absent, and reading it silently transcribes
     * nothing.
     */
    const entries = body.segments ?? [];
    if (entries.length === 0) {
      throw new Error(
        `Mistral returned no timed words for ${path.basename(chunk.file)}. ` +
          'The audio may be silent, or the model may not support word timestamps.',
      );
    }

    for (const entry of entries) {
      words.push({
        /* Each word arrives with a leading space. Trimming here rather than at
           every use keeps the rest of the pipeline free of the detail. */
        text: String(entry.text).trim(),
        start: entry.start + chunk.offset,
        end: entry.end + chunk.offset,
      });
    }
  }

  return { words: words.filter(word => word.text !== ''), language: detected };
}
