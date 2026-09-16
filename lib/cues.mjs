/**
 * Timed words into readable cues.
 *
 * This is the only file in the pipeline with judgement in it. A transcription
 * API returns either long segments or individual words. Neither is a subtitle.
 * A subtitle is a unit a person reads in one glance, while hearing the words
 * it belongs to.
 *
 * The limits below are the usual broadcast conventions. They are variables
 * because a vertical reel and a 20 minute talk do not want the same numbers.
 */

export const DEFAULTS = {
  /** Characters per line. 42 is the common ceiling for a 16:9 player. */
  maxLine: 42,
  /** Two lines. A third line covers the picture and gets read last. */
  maxLines: 2,
  /** Seconds. Past this a cue has been on screen long enough to be re-read. */
  maxDuration: 6,
  /** Seconds. Under this the eye cannot finish, however short the text. */
  minDuration: 1.2,
  /** Seconds of silence that end a cue whatever the character count says. */
  pause: 0.6,
  /** Seconds left between two cues, so they never touch. */
  gap: 0.04,
};

const SENTENCE_END = /[.!?…]["')\]]?$/;
const CLAUSE_END = /[,;:]["')\]]?$/;

const text = word => word.text.trim();
const charsOf = words => words.map(text).join(' ').length;

/**
 * Split on sentence ends and on long pauses.
 *
 * Sentences first, because a cue that spans two sentences reads as one and
 * sends the viewer back to re-read. Pauses second, because a speaker who stops
 * for a second has ended a thought whatever the punctuation says.
 */
function segments(words, options) {
  const out = [];
  let current = [];

  for (const [index, word] of words.entries()) {
    current.push(word);
    const next = words[index + 1];
    if (!next) break;
    const endsSentence = SENTENCE_END.test(text(word));
    const longPause = next.start - word.end >= options.pause;
    if (endsSentence || longPause) {
      out.push(current);
      current = [];
    }
  }

  if (current.length) out.push(current);
  return out;
}

/**
 * Whether these words fit one cue.
 *
 * The character budget is not enough on its own. 83 characters is under a
 * budget of 2 x 42, and still cannot be broken into two lines of 42 if no word
 * boundary falls in the right place. That cue renders as one line wider than
 * the player, so the check asks `wrap` directly rather than trusting the
 * arithmetic.
 */
const fits = (words, options) => {
  if (charsOf(words) > options.maxLine * options.maxLines) return false;
  if (words.at(-1).end - words[0].start > options.maxDuration) return false;
  const lines = wrap(words.map(text).join(' '), options).split('\n');
  return lines.length <= options.maxLines && lines.every(line => line.length <= options.maxLine);
};

/**
 * A group too small to be a cue on its own.
 *
 * A single word held for a second reads as a flash, not as a subtitle. This is
 * what lets `merge` join across a pause: the speaker did stop, and the cue is
 * still better joined than left alone.
 */
const orphan = (words, options) =>
  words.length <= 2 || charsOf(words) <= Math.round(options.maxLine / 2);

/**
 * Merge short neighbours.
 *
 * "Right." on its own line, for half a second, is a flash rather than a
 * subtitle. Two short sentences spoken together belong in one cue, as long as
 * the result still fits and the speaker did not pause between them.
 */
function merge(groups, options) {
  const out = [];
  for (const group of groups) {
    const previous = out.at(-1);
    if (!previous) {
      out.push(group);
      continue;
    }
    const joined = [...previous, ...group];
    const silence = group[0].start - previous.at(-1).end;
    const worthJoining =
      silence < options.pause || orphan(group, options) || orphan(previous, options);
    if (worthJoining && fits(joined, options)) out[out.length - 1] = joined;
    else out.push(group);
  }
  return out;
}

/**
 * Split a group that is still too long.
 *
 * The break goes at the last clause boundary that fits. Without one it goes at
 * the last word that fits, which is what a reader would do anyway. Recursive,
 * because one split is rarely enough on a long sentence.
 */
function split(words, options) {
  if (fits(words, options)) return [words];

  let cut = 0;
  let clause = 0;

  for (let i = 0; i < words.length - 1; i += 1) {
    if (!fits(words.slice(0, i + 1), options)) break;
    cut = i + 1;
    if (CLAUSE_END.test(text(words[i]))) clause = i + 1;
  }

  /* A clause break is only worth taking if it leaves a cue worth reading.
     Breaking after the first two words of a long sentence is technically a
     clause break and visibly wrong. */
  const at = clause >= cut / 2 && clause > 0 ? clause : cut || 1;
  return [words.slice(0, at), ...split(words.slice(at), options)];
}

/**
 * Two balanced lines, or one.
 *
 * Splitting at the midpoint rather than at the last word that fits gives two
 * lines of similar length, which is easier to read and does not leave one word
 * alone on the second line.
 */
export function wrap(line, options = DEFAULTS) {
  if (line.length <= options.maxLine) return line;
  const words = line.split(' ');
  let best = null;
  let head = '';

  for (let i = 0; i < words.length - 1; i += 1) {
    head += (i ? ' ' : '') + words[i];
    const tail = words.slice(i + 1).join(' ');
    if (head.length > options.maxLine || tail.length > options.maxLine) continue;
    const score = Math.abs(head.length - tail.length);
    if (!best || score < best.score) best = { score, head, tail };
  }

  /* No split fits the line limit: keep the text whole rather than lose words.
     A slightly long line is a smaller defect than a dropped one. */
  return best ? `${best.head}\n${best.tail}` : line;
}

/**
 * Timed words to cues.
 *
 * @param {{text:string,start:number,end:number}[]} words
 * @param {object} [settings] overrides for DEFAULTS, plus `duration` of the
 *   media, which bounds the last cue.
 */
export function toCues(words, settings = {}) {
  const options = { ...DEFAULTS, ...settings };
  const usable = words.filter(word => text(word) !== '');
  if (usable.length === 0) return [];

  const groups = merge(segments(usable, options), options).flatMap(group =>
    split(group, options),
  );

  const cues = groups.map(group => ({
    start: group[0].start,
    end: group.at(-1).end,
    text: wrap(group.map(text).join(' ').replace(/\s+/g, ' ').trim(), options),
  }));

  /*
   * Timing pass, and the order of the two rules is what matters.
   *
   * A cue is held to `minDuration` so it can be read, but the hold must never
   * reach into the next cue. Applying the floor first and the overlap rule
   * second produced cues that overlapped by a few milliseconds whenever two
   * words were spoken closer together than the floor. No player complained.
   * LinkedIn rejected the file and did not say which block was at fault.
   */
  for (const [index, cue] of cues.entries()) {
    const next = cues[index + 1];
    const ceiling = next ? next.start - options.gap : (settings.duration ?? Infinity);
    cue.end = Math.min(Math.max(cue.end, cue.start + options.minDuration), ceiling);
    /* A cue can still end before it starts if two words share a timestamp.
       Give it a readable floor and let the next one start late. */
    if (cue.end <= cue.start) cue.end = cue.start + 0.3;
  }

  return cues;
}
