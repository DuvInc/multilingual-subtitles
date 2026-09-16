#!/usr/bin/env node
/**
 * multilingual-subtitles
 *
 *   subs find                       what video files it can see
 *   subs transcribe [video]         video -> <name>.<lang>.srt
 *   subs translate <file.srt>       one SRT -> many languages
 *   subs check <file.srt>...        is this file valid
 *   subs run [video] --to fr,de     transcribe, then translate, then check
 *
 * Every step writes a file and stops. That is deliberate: transcription costs
 * cents and translation costs credits, so the expensive step never runs
 * because the cheap one happened to succeed. `run` chains them for when you
 * want that.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { duration, extractAudio, findVideos, requireFfmpeg, splitAudio } from '../lib/audio.mjs';
import { transcribe } from '../lib/transcribe.mjs';
import { toCues } from '../lib/cues.mjs';
import { toSrt } from '../lib/srt.mjs';
import { check, sameTimeline } from '../lib/check.mjs';
import { translateAll } from '../lib/translate.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORK = path.join(ROOT, '.work');

/* ------------------------------------------------------------------ setup */

/**
 * `.env`, read without a dependency.
 *
 * A real environment variable always wins, so CI and a shell export behave the
 * way anyone would expect. Nothing here is ever printed.
 */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
}

const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = argv[at + 1];
  return value && !value.startsWith('--') ? value : true;
};
const has = name => argv.includes(`--${name}`);
const positional = argv.filter((arg, index) => {
  if (arg.startsWith('--')) return false;
  const previous = argv[index - 1];
  /* A value that belongs to a flag is not a positional argument. */
  return !(previous?.startsWith('--') && !argv[index]?.startsWith('--') && isFlagValue(previous));
});

function isFlagValue(previousFlag) {
  return ['to', 'top', 'lang', 'model', 'out', 'quality', 'max-line', 'max-duration'].includes(
    previousFlag.replace(/^--/, ''),
  );
}

const say = line => process.stderr.write(`${line}\n`);

/* -------------------------------------------------------------- languages */

const catalogue = JSON.parse(readFileSync(path.join(ROOT, 'languages.json'), 'utf8')).languages;

/**
 * Which languages to translate into.
 *
 * `--to fr,de,es` names them. `--top 20` takes a slice of the catalogue, which
 * is ordered by YouTube audience, so the slice is a real answer to "the
 * languages worth having" rather than an arbitrary prefix.
 */
function requestedLanguages() {
  const to = flag('to');
  if (typeof to === 'string') {
    return to.split(',').map(tag => {
      const known = catalogue.find(language => language.tag === tag.trim());
      if (!known) {
        throw new Error(
          `Unknown language tag "${tag.trim()}". See languages.json, or run \`aiglot languages\` ` +
            'for the full catalogue. Add the entry to languages.json to use it here.',
        );
      }
      return known;
    });
  }
  const top = Number(flag('top', 0));
  if (top > 0) return catalogue.slice(0, top);
  return null;
}

/* --------------------------------------------------------------- commands */

function resolveVideo(target) {
  const { candidates, searched } = findVideos(target);
  if (candidates.length === 0) {
    throw new Error(
      `No video or audio file found. Looked in:\n  ${searched.join('\n  ')}\n` +
        'Pass a path: `npm run subs -- transcribe /path/to/video.mp4`',
    );
  }
  return { file: candidates[0], candidates };
}

function commandFind() {
  const { candidates, searched } = findVideos(positional[1]);
  say(`Looked in:\n  ${searched.join('\n  ')}\n`);
  if (candidates.length === 0) {
    say('Found nothing. Pass a path, or drop a file in ./media.');
    return;
  }
  say(`${candidates.length} file(s), newest first:\n`);
  for (const file of candidates.slice(0, 15)) console.log(file);
}

async function commandTranscribe() {
  requireFfmpeg();
  const { file, candidates } = resolveVideo(positional[1]);

  if (!positional[1] && candidates.length > 1) {
    say(`Using the newest of ${candidates.length} files found: ${file}`);
    say('Run `npm run subs -- find` to see the others, or pass a path.\n');
  }

  const seconds = duration(file);
  const language = typeof flag('lang') === 'string' ? flag('lang') : undefined;
  say(`${path.basename(file)}: ${seconds.toFixed(1)}s`);

  const audio = extractAudio(file, WORK);
  const chunks = splitAudio(audio, WORK);
  say(`audio extracted${chunks.length > 1 ? `, split into ${chunks.length} chunks` : ''}`);

  const { words, language: detected } = await transcribe(chunks, {
    model: typeof flag('model') === 'string' ? flag('model') : undefined,
    language,
    log: say,
  });
  say(`${words.length} words transcribed`);

  const cues = toCues(words, {
    duration: seconds,
    ...(flag('max-line') ? { maxLine: Number(flag('max-line')) } : {}),
    ...(flag('max-duration') ? { maxDuration: Number(flag('max-duration')) } : {}),
  });

  const tag = language ?? detected ?? 'src';
  const outDir = typeof flag('out') === 'string' ? flag('out') : path.dirname(file);
  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, `${path.basename(file, path.extname(file))}.${tag}.srt`);
  writeFileSync(target, toSrt(cues));

  const report = check(readFileSync(target, 'utf8'));
  say(`${cues.length} cues -> ${target}`);
  if (!report.ok) {
    say('This file does not validate. That is a bug in the cue builder, not in your video:');
    for (const problem of report.problems) say(`  cue ${problem.index}: ${problem.message}`);
    process.exitCode = 1;
    return null;
  }
  /* Warnings are printed and never fatal: a very short cue is usually the
     result of a correct fix, not a defect. See lib/check.mjs. */
  for (const warning of report.warnings) say(`  note: cue ${warning.index} ${warning.message}`);
  say('valid');
  console.log(target);
  return target;
}

async function commandTranslate(sourceFile) {
  const file = sourceFile ?? positional[1];
  if (!file) throw new Error('Usage: subs translate <file.srt> --to fr,de,es');
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);

  const languages = requestedLanguages();
  if (!languages) {
    throw new Error(
      'Say which languages: `--to fr,de,es`, or `--top 20` for the first 20 of languages.json.',
    );
  }

  /* Never translate a file that does not validate. A broken timecode becomes
     twenty broken timecodes, and each one costs credits. */
  const source = readFileSync(file, 'utf8');
  const report = check(source);
  if (!report.ok) {
    say(`${file} does not validate. Fix it before paying to translate it:`);
    for (const problem of report.problems) say(`  cue ${problem.index}: ${problem.message}`);
    process.exitCode = 1;
    return;
  }

  const outDir = typeof flag('out') === 'string' ? flag('out') : path.join(path.dirname(file), 'subtitles');
  say(`${report.cues} cues -> ${languages.length} language(s) -> ${outDir}\n`);

  const { results } = await translateAll({
    file,
    languages,
    outDir,
    quality: typeof flag('quality') === 'string' ? flag('quality') : undefined,
    log: say,
  });

  /* The check that matters on a translation: same timeline as the source. */
  let broken = 0;
  for (const result of results) {
    if (!result.file) continue;
    const verdict = sameTimeline(source, readFileSync(result.file, 'utf8'));
    if (!verdict.ok) {
      broken += 1;
      say(`\n${result.tag}: does not match the source timeline`);
      for (const problem of verdict.problems.slice(0, 3)) {
        say(`  cue ${problem.index}: ${problem.message}`);
      }
    }
  }

  const failed = results.filter(result => result.error);
  say('');
  say(`${results.filter(r => r.file).length} file(s) written, ${failed.length} failed, ${broken} out of sync`);
  if (failed.length) {
    say('Rerun the same command: finished languages are skipped and nothing is paid twice.');
    process.exitCode = 1;
  }
  for (const result of results.filter(r => r.file)) console.log(result.file);
}

function commandCheck() {
  const files = positional.slice(1);
  if (files.length === 0) throw new Error('Usage: subs check <file.srt>...');
  let bad = 0;
  for (const file of files) {
    const report = check(readFileSync(file, 'utf8'));
    if (report.ok) {
      console.log(`ok   ${file} (${report.cues} cues)`);
      for (const warning of report.warnings) {
        console.log(`       note: cue ${warning.index} ${warning.message}`);
      }
    } else {
      bad += 1;
      console.log(`FAIL ${file}`);
      for (const problem of report.problems) console.log(`       cue ${problem.index}: ${problem.message}`);
    }
  }
  if (bad) process.exitCode = 1;
}

async function commandRun() {
  /* Fail on a missing --to before spending anything on transcription. */
  requestedLanguages();
  const srt = await commandTranscribe();
  if (!srt) return;
  say('');
  await commandTranslate(srt);
}

/* ------------------------------------------------------------------- main */

loadEnv();

const command = positional[0];
try {
  if (command === 'find') commandFind();
  else if (command === 'transcribe') await commandTranscribe();
  else if (command === 'translate') await commandTranslate();
  else if (command === 'check') commandCheck();
  else if (command === 'run') await commandRun();
  else {
    console.error(
      [
        'Usage:',
        '  subs find [directory]                   list video files it can see',
        '  subs transcribe [video] [--lang en]     video -> a validated .srt',
        '  subs translate <file.srt> --to fr,de    one .srt -> many languages',
        '  subs translate <file.srt> --top 20      the first 20 of languages.json',
        '  subs check <file.srt>...                validate files',
        '  subs run [video] --to fr,de,es          all of the above, in order',
        '',
        'Options: --out <dir>  --model <id>  --quality lite|standard',
        '         --max-line <chars>  --max-duration <seconds>',
      ].join('\n'),
    );
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`\n${error.message ?? error}`);
  process.exitCode = 1;
}
