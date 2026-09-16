# AGENTS.md

Instructions for any AI agent working in this repository. `CLAUDE.md` is a
symlink to this file.

Read this before changing the pipeline. Most of the rules below exist because
the failure they prevent is invisible: a subtitle file that every local player
displays correctly, and that an upload form rejects or a viewer sees drift out
of sync halfway through.

## What this repository is

A local command-line tool. It turns one video file into subtitle files in many
languages.

```text
video ──▶ ffmpeg ──▶ audio ──▶ Mistral ──▶ timed words ──▶ cues ──▶ .srt ──▶ AI Glot ──▶ .srt per language
```

There are no npm dependencies. `ffmpeg` is the only thing that must be
installed.

## Layout

| Path | What it is |
| --- | --- |
| `bin/subs.mjs` | the CLI. Argument parsing, and the order the steps run in |
| `lib/audio.mjs` | find the video, probe it, extract audio, split it if large |
| `lib/transcribe.mjs` | **the only file that talks to Mistral**. Returns `{text,start,end}[]` |
| `lib/cues.mjs` | timed words to readable cues. The only file with judgement in it |
| `lib/srt.mjs` | read and write SRT |
| `lib/check.mjs` | validate one file, and compare a translation against its source |
| `lib/translate.mjs` | **the only file that talks to AI Glot**. One batch per language |
| `languages.json` | 50 languages, ordered by YouTube audience |
| `skills/subtitles/SKILL.md` | the procedure, as a skill. Symlinked from `.claude/skills/` |

## Commands

```bash
npm test                                   # 18 assertions, no network, no key
npm run subs -- find
npm run subs -- transcribe <video>
npm run subs -- translate <file.srt> --to fr,de,es
npm run subs -- check <file.srt>...
npm run subs -- run <video> --to fr,de,es
```

Node 22.18 or newer.

## Finding the user's video

Do not ask the user to move their file. `subs find` looks in the current
directory, `./media`, `~/Downloads`, `~/Desktop`, `~/Movies` and `~/Videos`,
and returns candidates newest first.

If the user says "the video I just downloaded" or "my latest recording", run
`subs find`, show them the top few, and confirm which one before transcribing.
Transcription costs money, so guessing wrong wastes it.

## The rules

0. **A short cue is a warning, not a failure.** `check` returns `problems`
   (overlap, unreadable timecode, end before start, empty text) and `warnings`
   (a cue too short to read comfortably). Only problems fail a file. A cue of
   200 ms is usually what a correct overlap fix produces, and failing on it
   would fail the corrected file while passing the broken one.
1. **Never write an SRT without validating it.** `bin/subs.mjs` runs `check`
   after transcription and refuses to translate a file that fails. A broken
   timecode translated into twenty languages is twenty broken files, each one
   paid for.
2. **Never let a cue overlap the next one.** Players do not care. Upload forms
   reject the whole file without naming the block. The rule lives in the timing
   pass at the end of `toCues`, and the order of its two operations is the
   whole point: the minimum-duration floor is clamped by the next cue's start,
   not applied after it.
3. **Never modify a timecode during translation.** AI Glot keeps them. The
   check after translation compares cue count and timecodes against the source,
   and this is the one check that catches a translator that merged two cues.
4. **One batch per language.** An SRT file holds one language track. This is
   not a tuning decision.
5. **Only `approve` spends credits.** Creating a batch and reading its plan are
   free and repeatable.

## Changing the transcriber

`lib/transcribe.mjs` returns `{ text, start, end }[]` with times in seconds
from the start of the media. Everything downstream depends on that shape and on
nothing else.

To use whisper.cpp instead:

1. Replace the body of `transcribe()`. Run `whisper-cli` with `-ml 1` so it
   emits one token per segment, then map its JSON to the array above.
2. Run `npm test`. The cue tests do not touch the network and will tell you
   whether the output still groups correctly.
3. Transcribe a short clip and read the SRT. Two things differ from Mistral and
   both change the result: some whisper models return lower-case text with no
   punctuation, which removes the sentence boundaries `lib/cues.mjs` breaks on,
   and word timings from a model without DTW alignment sit on a coarse grid.

Say in the pull request which model you tested and on what audio. "It works"
is not a description of a transcriber.

## Setting the two services up

**Mistral**, for transcription. A key from
[console.mistral.ai](https://console.mistral.ai) goes in `.env` as
`MISTRAL_API_KEY`. The tool loads `.env` itself, with a real environment
variable always winning. Never print the key, never commit it, never paste it
into a command line where the shell records history.

**AI Glot**, for translation. Two ways in:

| | CLI (default) | API (`AIGLOT_TRANSPORT=api`) |
| --- | --- | --- |
| Install | `npm i -g @ai-glot/cli` | nothing |
| Credentials | `aiglot auth login`, or `AIGLOT_API_KEY` | `AIGLOT_API_KEY` |
| Retries and backoff | handled | yours to write |
| Right for | a laptop, most CI | an image you do not control |

The endpoints the API transport uses, if you need them directly:

| Call | What it does | Spends credits |
| --- | --- | --- |
| `POST /v1/batches` | upload `{ content, filename, instruction }` | no |
| `GET /v1/batches/{id}` | status, plan, progress, error | no |
| `POST /v1/batches/{id}/approve` | `{ quality, custom_instructions }`, starts the work | **yes** |
| `GET /v1/batches/{id}/result?format=content` | the translated file inline | no |

Wait for a terminal status: `completed`, `failed` or `cancelled`. Never wait
for `completed` alone, or a failed batch is polled until the loop gives up.

## Cost, and how to talk about it

Transcription is billed per second of audio. Translation is one credit per
three words in Lite, one per word in Standard. Lite is the default here and the
right tier for subtitles.

Before a large run, tell the user the number. Twenty languages of a 3,000 word
talk is roughly 20,000 credits. That is a decision they should make with the
figure in front of them, not after the fact.

## Rules for agents

- **Do not translate an SRT yourself when the user wants more than one
  language.** Use `subs translate`. Retyping timecodes is how they get
  corrupted, and you will be slower and more expensive than the batch API. For
  a single language, doing it yourself is reasonable.
- **Do not hand-edit a generated `.srt` to fix a timing defect.** The defect is
  in `lib/cues.mjs` and will come back on the next run. Fix it there, add a
  case to `test/cues.test.mjs`, and regenerate.
- **Do not raise the character or duration limits to make a file shorter.**
  They are readability limits, not formatting preferences.
- **Do not commit media.** `.gitignore` excludes video and audio. A 600 MB MP4
  in the history is permanent.
- **Do not print or log an API key**, and do not copy `.env` anywhere.
- **No em dashes** in code, comments, documentation or output.

## Things that bite

- **Mistral returns word timestamps under `segments`, not under `words`.** The
  response shape is the same for both granularities. Reading `body.words`
  returns undefined and transcribes nothing, silently.
- **Requesting both granularities in one call fails with a 422.** The two
  values are concatenated by the form encoder. Ask for words; the text is the
  words joined.
- **Every word arrives with a leading space.** `lib/transcribe.mjs` trims once,
  so nothing downstream has to know.
- **A character budget is not the same as a wrappable line.** 83 characters is
  under a limit of 2 x 42 and still cannot be split into two lines if no word
  boundary falls in the right place. `fits()` asks `wrap()` rather than
  trusting the arithmetic.
- **Chunk offsets must be measured, not assumed.** `ffmpeg -f segment` cuts on
  frame boundaries, so a "fifteen minute" chunk is slightly longer. Assuming
  the requested length drifts every timestamp after the first chunk, and the
  drift accumulates across an hour-long video.
- **A one-word cue is a defect, not a short sentence.** `merge()` joins it to a
  neighbour even across a pause.
