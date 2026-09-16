---
name: subtitles
description: Turn a video into subtitle files, in one language or many. Use when the user wants subtitles, captions or an SRT from a video, when they want an existing SRT translated, when a subtitle file is rejected by an upload form, or when they ask what a multilingual subtitle run would cost.
---

# Subtitles from a video

The procedure. The reasoning is in `AGENTS.md`, the evidence and the cost model
in `README.md`.

## 1. Find the file

```bash
npm run subs -- find
```

It lists video and audio files from the current directory, `./media`,
`~/Downloads`, `~/Desktop`, `~/Movies` and `~/Videos`, newest first.

Show the user the top few and confirm which one before going further.
Transcription costs money, so a wrong guess wastes it. Never ask them to move
the file.

## 2. Transcribe

```bash
npm run subs -- transcribe <video> --lang en
```

`--lang` is optional and worth passing. Without it the model guesses, and on a
short clip it sometimes guesses wrong and returns the whole transcript in
another language.

The command writes `<video>.<lang>.srt` next to the video and validates it
before reporting success. If validation fails, that is a bug in
`lib/cues.mjs`, not in the user's file. Fix it there and add a case to
`test/cues.test.mjs`.

Read the SRT before going further. Transcription errors are cheap to fix now
and get translated into every language later.

## 3. Decide the languages, and say the price

```bash
npm run subs -- translate <file.srt> --to fr,de,es
npm run subs -- translate <file.srt> --top 20
```

`--top 20` takes the first 20 of `languages.json`, which is ordered by YouTube
audience.

**Tell the user the cost before running a large job.** One credit per three
words in Lite. A 3,000 word talk is about 1,000 credits per language, so twenty
languages is about 20,000. That is their decision to make with the number in
front of them.

## 4. Check what came back

The command already compares every translation against the source timeline and
reports anything out of sync. Two more things are worth doing by hand:

```bash
npm run subs -- check subtitles/*.srt
diff <(grep -- '-->' talk.en.srt) <(grep -- '-->' subtitles/talk.fr.srt) && echo same
```

Read one language you speak. The translator works cue by cue, and a cue is a
fragment cut for reading speed rather than for grammar.

## 5. Rerun, if anything failed

Run the same command again. Languages already on disk are skipped, a batch that
was created but never downloaded is resumed, and nothing is paid twice. A
failure in one language never stops the others.

## When to do it yourself instead

One language, and the user is in a hurry: translating the SRT yourself is
reasonable.

More than one language: use the tool. Retyping timecodes by hand is how they
get corrupted, the file goes through the context once per language, and
generation prices for a mechanical job are worse than one credit per three
words.

## What not to do

| Tempting | Why it is wrong |
| --- | --- |
| Hand-editing a generated `.srt` to fix a timing defect | the defect is in `lib/cues.mjs` and returns on the next run |
| Raising `--max-line` to reduce the cue count | it is a readability limit, not a formatting preference |
| Translating an SRT that did not validate | one broken timecode becomes twenty, each one paid for |
| Committing the video | `.gitignore` excludes media, and history is permanent |
| Printing the API key to check it is set | test with a one-second clip instead |
