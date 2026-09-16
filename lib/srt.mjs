/**
 * Reading and writing SRT.
 *
 * SRT is a simple format with two rules that matter. Blocks are numbered from
 * 1 with no gaps. Timecodes are `hh:mm:ss,mmm`, with a comma before the
 * milliseconds and not a dot. Players are forgiving about both. Upload forms
 * are not: LinkedIn rejects a whole file and does not say which block is
 * wrong.
 */

/** Seconds to `hh:mm:ss,mmm`. */
export function stamp(seconds) {
  /* Truncated, not rounded. One millisecond of rounding up starts a cue before
     the word is spoken, and that is visible. */
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const rest = ms % 1000;
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`;
}

/** `hh:mm:ss,mmm` to seconds. Accepts a dot as well, because some tools emit one. */
export function seconds(text) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(text.trim());
  if (!match) return null;
  const [, h, m, s, ms] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/**
 * Cues to an SRT file.
 *
 * @param {{start:number,end:number,text:string}[]} cues
 */
export function toSrt(cues) {
  return (
    cues
      .map((cue, index) =>
        [`${index + 1}`, `${stamp(cue.start)} --> ${stamp(cue.end)}`, cue.text, ''].join('\n'),
      )
      .join('\n') + ''
  );
}

/**
 * An SRT file to cues.
 *
 * Tolerant on input: it accepts CRLF, a UTF-8 BOM, and blank lines between
 * blocks. It is strict on output, because this is also what `subs check`
 * parses, and a checker that accepts what it should reject is worse than no
 * checker.
 */
export function fromSrt(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const blocks = clean.split(/\n{2,}/).filter(block => block.trim() !== '');

  return blocks.map((block, index) => {
    const lines = block.split('\n');
    /* The index line is optional in the wild. If the first line is not a
       number, the block starts at its timecode. */
    const hasIndex = /^\d+$/.test(lines[0].trim());
    const indexLine = hasIndex ? Number(lines[0].trim()) : null;
    const timeLine = hasIndex ? lines[1] : lines[0];
    const body = (hasIndex ? lines.slice(2) : lines.slice(1)).join('\n').trim();

    const [from, to] = (timeLine ?? '').split('-->');
    return {
      index: indexLine ?? index + 1,
      declaredIndex: indexLine,
      start: from ? seconds(from) : null,
      end: to ? seconds(to) : null,
      text: body,
      raw: block,
    };
  });
}
