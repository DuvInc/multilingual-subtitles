# multilingual-subtitles

![multilingual-subtitles: a dithered banner with the project name and its one-line summary](docs/hero.png)

**Subtitles in twenty languages, from one video file, in one command.**

Transcribing a video is the easy half and a dozen tools do it. This one is
built for the other half: getting that subtitle file into every language your
audience reads, without retyping a single timecode and without paying
generation prices twenty times over.

It is a local command-line tool. It extracts the audio, transcribes it with
word-level timestamps, builds a valid SRT, and translates that SRT into every
language you ask for. Nothing leaves your machine except the audio and the
subtitle text.

```bash
npm run subs -- run ~/Downloads/clip.mp4 --to fr,de,ja
```

A real run, on a 36 second clip:

```text
clip.mp4: 35.9s
audio extracted
101 words transcribed
10 cues -> ~/Downloads/clip.en.srt
valid

fr: batch 251c04a6-281c-489e-8125-9a861478893b
de: batch ef19db63-0eec-4b49-b436-e1d01ac60efd
ja: batch ce45a2df-51cb-4173-982e-3bfcc07a2a2f
fr: written, 34 credits
de: written, 34 credits
ja: written, 34 credits

3 file(s) written, 0 failed, 0 out of sync
```

## What you need

| | |
| :--- | :--- |
| **ffmpeg** | `brew install ffmpeg`, or `apt install ffmpeg`. Used to read the video and extract the audio |
| **Node 22.18+** | no npm dependencies, so `npm install` installs nothing |
| **A Mistral API key** | for transcription. [console.mistral.ai](https://console.mistral.ai) |
| **AI Glot** | for translation only. A [CLI login](https://ai-glot.com) or an API key |

You can stop after transcription and never touch the translation half. You can
also skip transcription and translate an SRT you already have.

## Quick start

```bash
git clone https://github.com/DuvInc/multilingual-subtitles
cd multilingual-subtitles
npm install
cp .env.example .env        # then put your Mistral key in it

npm run subs -- find                          # what videos it can see
npm run subs -- transcribe ~/Downloads/talk.mp4
npm run subs -- translate ~/Downloads/talk.en.srt --to fr,de,es
```

You do not have to move your video into this repository. Pass a path, pass a
folder, or pass nothing: `find` looks in the current directory, `./media`,
`~/Downloads`, `~/Desktop`, `~/Movies` and `~/Videos`, and lists what it finds,
newest first.

## How it works

```text
  your-video.mp4
        │
        │  ffmpeg: mono, 16 kHz, 64 kbps mp3
        │  36 seconds of speech becomes 281 KB. An hour becomes 28 MB,
        │  which is split into chunks before upload.
        ▼
  audio.mp3 ──────────▶ Mistral  (voxtral-mini-latest)
        │               timestamp_granularities=word
        │               returns every word with a start and an end
        ▼
  words + timestamps
        │
        │  lib/cues.mjs groups words into cues:
        │    break on sentence ends and on pauses over 0.6s
        │    at most 2 lines of 42 characters, at most 6 seconds
        │    hold each cue 1.2s minimum, never into the next one
        ▼
  your-video.en.srt  ──▶ validated before anything else happens
        │
        │  one AI Glot batch per language, 4 in flight
        │  an SRT file holds one language track, so N languages are N batches
        ▼
  subtitles/your-video.fr.srt
  subtitles/your-video.de.srt
  subtitles/your-video.ja.srt
        │
        └─▶ each one checked against the source timeline: same cue count,
            same timecodes, no empty cue
```

## Why word timestamps

The same Mistral endpoint returns either whole segments or individual words.
This tool asks for words, at the same price.

A segment is a sentence, sometimes seven seconds of speech in one block. That
is not a subtitle. Turning it into one means guessing where inside those seven
seconds each phrase was spoken, and the guess drifts. With word timings, the
cue builder groups by what reads well, and every cue still starts exactly on
the word it shows.

## Why not ask your agent to translate the SRT

For one language, do that. It works.

For twenty languages it is the wrong tool three times over. The model rewrites
every timecode by hand, and eventually mistypes one. The whole file passes
through the context window once per language. You pay generation prices for a
mechanical task.

AI Glot reads `.srt` natively. It keeps the cue numbering and the timecodes
byte for byte, and charges one credit per three words in its Lite tier. A
measured example from this repository's own test run: a 36 second clip, 101
words, 34 credits per language.

| | One agent doing it | AI Glot |
| :--- | :--- | :--- |
| Timecodes | retyped, and eventually wrong | untouched |
| 20 languages | 20 passes through the context | 20 batches, 4 at a time |
| Cost of 3,000 words | generation prices, 20 times | about 1,000 credits per language |
| Resumable | no | yes, with a manifest |

## Commands

| | |
| :--- | :--- |
| `subs find [dir]` | list video and audio files it can see |
| `subs transcribe [video]` | video to a validated `.srt` |
| `subs translate <file.srt> --to fr,de` | one `.srt` into named languages |
| `subs translate <file.srt> --top 20` | the first 20 of `languages.json` |
| `subs check <file.srt>...` | validate files |
| `subs run [video] --to fr,de,es` | all of the above, in order |

Options: `--out <dir>`, `--lang <code>`, `--model <id>`, `--quality lite|standard`,
`--max-line <chars>`, `--max-duration <seconds>`.

`check` separates two kinds of defect. A **problem** gets the file rejected by
an upload form: an overlap, an unreadable timecode, a cue that ends before it
starts, an empty cue. A **note** is only uncomfortable to read, and a very
short cue is the usual one. That distinction matters because pulling a cue back
to clear an overlap often leaves it at 200 ms: failing on that would fail the
corrected file and pass the broken one.

Each step writes a file and stops. Transcription costs cents. Translation costs
credits. Keeping them apart means the expensive step never runs just because
the cheap one succeeded. `run` chains them when you want that.

## What it is for

**YouTube subtitle coverage, which is the reason this exists.** YouTube serves
a subtitle track in the viewer's language when you upload one, and most
channels upload one language because producing twenty is a day of work.
`languages.json` holds 50 languages ordered by YouTube audience, so `--top 20`
is the slice worth having rather than an arbitrary prefix. Twenty languages of
a 20 minute talk is one command and about 20,000 credits.

**A video you did not caption.** A recorded talk, a demo, a customer call. One
command gives you a transcript you can read and a subtitle file you can upload.

**Accessibility.** A subtitle file in the original language is the minimum, and
this produces one that validates.

## Swapping the transcriber

`lib/transcribe.mjs` is the only file that talks to Mistral. Everything after
it consumes `{ text, start, end }[]`.

To use something else, replace that file and return the same array. whisper.cpp
with `-ml 1`, faster-whisper, Deepgram and AssemblyAI all produce word timings
in some shape.

Local transcription with whisper.cpp is the common reason to switch: it costs
nothing per minute and the audio never leaves the machine. It is slower, and
`whisper` returns lower-case text without punctuation on some models, which
makes worse subtitles. Read `AGENTS.md` before changing it; it says what the
rest of the pipeline assumes.

## Files it writes

```
~/Downloads/talk.mp4              your video, untouched
~/Downloads/talk.en.srt           the transcription
~/Downloads/subtitles/
  talk.fr.srt                     one file per language
  talk.de.srt
  talk.manifest.json              batch id, status, words and credits per language
.work/                            extracted audio and chunks, safe to delete
```

The manifest is what makes a rerun free. Languages already on disk are skipped.
A batch that was created but never downloaded is resumed instead of paid for
twice. A failure in one language does not stop the others.

## Cost

| | |
| :--- | :--- |
| Transcription | Mistral bills per second of audio. A 36 second clip used 35 seconds of audio and 201 tokens |
| Translation | one credit per three words in Lite, one per word in Standard |
| Measured | 101 words, 34 credits per language, 3 languages, one run |
| A 20 minute talk | roughly 3,000 words, so about 1,000 credits per language in Lite |

Only approval spends credits. Creating a batch and reading its priced plan are
free.

## Status and licence

A working tool. One person maintains it, on a best-effort basis. It is not a
published package. Fork it and take what you need.

MIT. See [LICENSE](./LICENSE), [CONTRIBUTING.md](./CONTRIBUTING.md) and
[SECURITY.md](./SECURITY.md).

[AGENTS.md](./AGENTS.md) is the manual for an AI agent working in this
repository, and `skills/subtitles/` is the same procedure as a skill.
`CLAUDE.md` is a symlink to AGENTS.md.
