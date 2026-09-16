# Contributing

Thanks for looking. This is a one-person project maintained on a best-effort
basis, so the most useful thing you can do before writing code is open an issue.
A small fix is always welcome; a large one is worth agreeing on first.

## Getting set up

Node 22.18 or newer, and ffmpeg on your PATH. There are no npm dependencies.

```bash
npm install     # installs nothing, and that is the point
npm test        # 18 assertions, no network, no API key
```

`npm test` passes on a fresh clone with no keys. If it does not, that is a bug
worth reporting on its own.

To exercise the parts that cost money you need a Mistral key and an AI Glot
login. A ten second clip is enough, and costs about a cent.

## Sign your commits off

Every commit needs a `Signed-off-by` line, which certifies that you wrote the
patch or otherwise have the right to submit it under the MIT licence. This is
the [Developer Certificate of Origin](https://developercertificate.org): one
line, no paperwork, no copyright assignment.

```bash
git commit -s -m "Your message"
```

## What makes a change likely to be merged

**A timing change comes with a test.** `lib/cues.mjs` is the only file with
judgement in it, and every rule in it exists because of a file that was
rejected or displayed wrong. If you change a limit or a break rule, add the
case to `test/cues.test.mjs` that shows what it now does.

**No new dependency.** The tool has none, and ffmpeg is already a large thing
to ask for. A dependency needs an argument in an issue first.

**The two service files stay the only ones that talk to a service.**
`lib/transcribe.mjs` for Mistral, `lib/translate.mjs` for AI Glot. Replacing
either is a supported way to use this tool; that stays true only while the
boundary holds.

**Report what you measured.** For a transcriber change, say which model and
what audio. For a cost change, give the credits. "Works for me" is not a
result.

**Comments explain why, not what.** The existing ones are long on purpose: they
record the reasoning, and where it matters, what went wrong before.

**No em dashes**, anywhere.

## Reporting a bug

Include the commit, the command you ran, and what happened. For a subtitle
problem, paste the cue: the block number, its timecode line and its text. That
is usually enough to find it.

For anything with security implications, read [SECURITY.md](./SECURITY.md)
instead of opening a public issue.
