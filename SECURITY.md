# Security policy

## Reporting a vulnerability

Please report privately rather than in a public issue, using GitHub's
[private vulnerability reporting](https://github.com/DuvInc/multilingual-subtitles/security/advisories/new)
on this repository.

This is a one-person project. You should get an acknowledgement within a few
days; if a week passes with no reply, feel free to nudge by opening a public
issue that says only that you are waiting on a private report, with no details.

## What is in scope

This tool runs locally, reads media files, and sends audio and text to two
APIs. The interesting surface:

- **Key handling.** Anything that causes `MISTRAL_API_KEY` or `AIGLOT_API_KEY`
  to be written to a tracked file, printed to output, recorded in shell
  history, or sent anywhere other than its own service.
- **Command construction.** `lib/audio.mjs` and `lib/translate.mjs` run
  `ffmpeg`, `ffprobe` and `aiglot`. Both use `execFileSync` with an argument
  array, so a file name cannot become a shell command. A change that
  reintroduces string interpolation into a shell is the bug to look for.
- **Path handling.** A media file name or a language tag that escapes the
  intended output directory.
- **What leaves the machine.** Audio goes to Mistral, subtitle text goes to AI
  Glot, and nothing else is uploaded. A change that sends more than that, or
  sends it somewhere else, is in scope whether or not it is exploitable.

## What is out of scope

- Mistral and AI Glot themselves. Report those to their operators.
- Transcription or translation quality.
- A vulnerability that requires the attacker to already have commit access, or
  to already be able to run code as you.

## If you forked this tool

Replace the link above with your own repository. This file arrived with the
code and points at somebody else's advisories.
