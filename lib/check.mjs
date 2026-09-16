import { fromSrt } from './srt.mjs';

/**
 * Is this SRT valid?
 *
 * TWO CATEGORIES, AND THE DISTINCTION IS LOAD-BEARING.
 *
 * A `problem` gets the file rejected: an overlap, an unreadable timecode, a
 * cue that ends before it starts, an empty cue. These are worth failing a
 * build over.
 *
 * A `warning` is only uncomfortable to read, and a very short cue is the one
 * that matters. It is often the CONSEQUENCE of fixing an overlap: pull a cue
 * back so it stops before the next one starts and it can end up at 150 to 340
 * milliseconds. Failing on that would mean the corrected file fails validation
 * while the broken one, whose cues all lasted a comfortable 400 ms, passed.
 * That is exactly backwards, and it is how a real subtitle set spent a week
 * looking fine while LinkedIn rejected it.
 */
export function check(text, { minDuration = 0.3 } = {}) {
  const cues = fromSrt(text);
  const problems = [];
  const warnings = [];
  const say = (index, message) => problems.push({ index, message });
  const warn = (index, message) => warnings.push({ index, message });

  if (cues.length === 0) problems.push({ index: 0, message: 'no cues' });

  for (const [position, cue] of cues.entries()) {
    const number = position + 1;

    /* Numbering. Some players renumber silently, others stop at the gap. */
    if (cue.declaredIndex !== null && cue.declaredIndex !== number) {
      say(number, `numbered ${cue.declaredIndex}, expected ${number}`);
    }
    if (cue.start === null || cue.end === null) {
      say(number, 'unreadable timecode, expected hh:mm:ss,mmm --> hh:mm:ss,mmm');
      continue;
    }
    if (cue.end <= cue.start) say(number, 'ends before it starts');
    else if (cue.end - cue.start < minDuration) {
      warn(number, `lasts ${(cue.end - cue.start).toFixed(3)}s, which is hard to read`);
    }
    if (cue.text.trim() === '') say(number, 'no text');

    /* Overlap. This is the one that gets a file rejected while every local
       player shows it correctly. */
    const next = cues[position + 1];
    if (next && next.start !== null && next.start < cue.end) {
      say(number, `overlaps cue ${number + 1} by ${(cue.end - next.start).toFixed(3)}s`);
    }
  }

  return { cues: cues.length, problems, warnings, ok: problems.length === 0 };
}

/**
 * Do two SRT files describe the same timeline?
 *
 * The check to run on a translation before uploading it. A translator that
 * renumbers, merges or drops a cue produces a file that looks fine and drifts
 * out of sync partway through, which is only visible by watching the video in
 * a language you may not speak.
 */
export function sameTimeline(sourceText, targetText) {
  const source = fromSrt(sourceText);
  const target = fromSrt(targetText);
  const problems = [];

  if (source.length !== target.length) {
    problems.push({
      index: 0,
      message: `${target.length} cues against ${source.length} in the source`,
    });
    return { ok: false, problems };
  }

  for (const [position, cue] of source.entries()) {
    const other = target[position];
    if (cue.start !== other.start || cue.end !== other.end) {
      problems.push({ index: position + 1, message: 'timecode differs from the source' });
    }
    if (other.text.trim() === '') {
      problems.push({ index: position + 1, message: 'translated cue is empty' });
    }
  }

  return { ok: problems.length === 0, problems };
}
