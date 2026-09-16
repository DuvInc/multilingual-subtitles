import assert from 'node:assert/strict';
import test from 'node:test';

import { check, sameTimeline } from '../lib/check.mjs';
import { toSrt } from '../lib/srt.mjs';

const valid = toSrt([
  { start: 0, end: 2, text: 'First' },
  { start: 2.1, end: 4, text: 'Second' },
]);

test('a good file passes', () => {
  const report = check(valid);
  assert.equal(report.ok, true);
  assert.equal(report.cues, 2);
});

test('an overlap is reported', () => {
  const file = '1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n2\n00:00:01,900 --> 00:00:04,000\nSecond\n';
  const report = check(file);
  assert.equal(report.ok, false);
  assert.match(report.problems[0].message, /overlaps cue 2/);
});

test('a numbering gap is reported', () => {
  const file = '1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n3\n00:00:02,100 --> 00:00:04,000\nSecond\n';
  assert.match(check(file).problems[0].message, /numbered 3, expected 2/);
});

test('an empty cue and a reversed cue are reported', () => {
  const file = '1\n00:00:02,000 --> 00:00:01,000\nBackwards\n\n2\n00:00:03,000 --> 00:00:05,000\n \n';
  const messages = check(file).problems.map(problem => problem.message).join(' ');
  assert.match(messages, /ends before it starts/);
  assert.match(messages, /no text/);
});

test('a very short cue warns and does not fail the file', () => {
  /* The case that matters: pulling a cue back to clear an overlap can leave it
     at 200 ms. Failing on that would fail the corrected file and pass the
     broken one. */
  const file = '1\n00:00:00,000 --> 00:00:00,200\nShort\n\n2\n00:00:01,000 --> 00:00:03,000\nNormal\n';
  const report = check(file);
  assert.equal(report.ok, true, 'a short cue must not fail the file');
  assert.equal(report.problems.length, 0);
  assert.match(report.warnings[0].message, /hard to read/);
});

test('a broken timecode is reported and does not throw', () => {
  const file = '1\n00:00:00,000 -> 00:00:02,000\nFirst\n';
  const report = check(file);
  assert.equal(report.ok, false);
  assert.match(report.problems[0].message, /unreadable timecode/);
});

test('a translation that keeps the timeline passes', () => {
  const translated = toSrt([
    { start: 0, end: 2, text: 'Premier' },
    { start: 2.1, end: 4, text: 'Deuxième' },
  ]);
  assert.equal(sameTimeline(valid, translated).ok, true);
});

test('a translation that drops or moves a cue fails', () => {
  const dropped = toSrt([{ start: 0, end: 2, text: 'Premier' }]);
  assert.match(sameTimeline(valid, dropped).problems[0].message, /1 cues against 2/);

  const drifted = toSrt([
    { start: 0, end: 2, text: 'Premier' },
    { start: 2.5, end: 4, text: 'Deuxième' },
  ]);
  assert.match(sameTimeline(valid, drifted).problems[0].message, /timecode differs/);

  const empty = toSrt([
    { start: 0, end: 2, text: 'Premier' },
    { start: 2.1, end: 4, text: '' },
  ]);
  assert.match(sameTimeline(valid, empty).problems[0].message, /empty/);
});
