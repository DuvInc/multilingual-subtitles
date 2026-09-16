import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULTS, toCues, wrap } from '../lib/cues.mjs';

/** Words at a steady pace, from a sentence. */
const speak = (sentence, { from = 0, wordSeconds = 0.3, gapBefore = 0 } = {}) => {
  let clock = from + gapBefore;
  return sentence.split(' ').map(word => {
    const entry = { text: word, start: clock, end: clock + wordSeconds };
    clock += wordSeconds;
    return entry;
  });
};

test('no cue overlaps the next one', () => {
  /* The defect that gets a file rejected by an upload form while every local
     player shows it correctly. It appears when the minimum-duration floor
     reaches past the start of the next cue. */
  const words = [
    ...speak('Yes.'),
    ...speak('No.', { from: 0.5 }),
    ...speak('Maybe so.', { from: 1 }),
  ];
  const cues = toCues(words);
  for (const [index, cue] of cues.entries()) {
    assert.ok(cue.end > cue.start, `cue ${index + 1} ends before it starts`);
    const next = cues[index + 1];
    if (next) assert.ok(cue.end <= next.start, `cue ${index + 1} overlaps cue ${index + 2}`);
  }
});

test('every line fits the character limit', () => {
  const words = speak(
    'And whenever I was using a different harness I was never sure if I had all my connections working properly today',
  );
  const cues = toCues(words);
  for (const cue of cues) {
    for (const line of cue.text.split('\n')) {
      assert.ok(line.length <= DEFAULTS.maxLine, `line of ${line.length} characters: ${line}`);
    }
    assert.ok(cue.text.split('\n').length <= DEFAULTS.maxLines);
  }
});

test('no cue lasts longer than the ceiling', () => {
  const words = speak('One two three four five six seven eight nine ten', { wordSeconds: 1 });
  for (const cue of toCues(words)) {
    assert.ok(cue.end - cue.start <= DEFAULTS.maxDuration + 0.01);
  }
});

test('a single word is merged rather than left alone', () => {
  /* "And" on its own, held for a second, reads as a flash. It is joined to its
     neighbour even though the speaker paused, because the alternative is
     worse. */
  const words = [
    ...speak('This is a full sentence.'),
    ...speak('And', { from: 3 }),
    ...speak('the rest follows here.', { from: 4.2 }),
  ];
  const cues = toCues(words);
  assert.ok(
    cues.every(cue => cue.text.trim().split(/\s+/).length > 1),
    `a one-word cue survived: ${JSON.stringify(cues.map(c => c.text))}`,
  );
});

test('every word reaches the output, in order', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog and keeps running until it stops.';
  const cues = toCues(speak(sentence));
  const rebuilt = cues.map(cue => cue.text.replace(/\n/g, ' ')).join(' ');
  assert.equal(rebuilt, sentence);
});

test('wrap balances two lines and never invents a break it cannot make', () => {
  const balanced = wrap('one two three four five six seven eight nine ten eleven twelve');
  const [head, tail] = balanced.split('\n');
  assert.ok(head.length <= DEFAULTS.maxLine && tail.length <= DEFAULTS.maxLine);
  assert.ok(Math.abs(head.length - tail.length) < 12, 'the two lines are lopsided');

  /* One word longer than the limit cannot be broken. Keeping it whole is the
     smaller defect; dropping characters would be the larger one. */
  const unbreakable = 'x'.repeat(60);
  assert.equal(wrap(unbreakable), unbreakable);
});

test('the last cue stops at the end of the media', () => {
  const words = speak('A short closing line.', { from: 9 });
  const cues = toCues(words, { duration: 10 });
  assert.ok(cues.at(-1).end <= 10);
});
