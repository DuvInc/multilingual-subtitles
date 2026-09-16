import assert from 'node:assert/strict';
import test from 'node:test';

import { fromSrt, seconds, stamp, toSrt } from '../lib/srt.mjs';

test('timecodes round-trip', () => {
  assert.equal(stamp(0), '00:00:00,000');
  assert.equal(stamp(1.5), '00:00:01,500');
  assert.equal(stamp(3661.123), '01:01:01,123');
  assert.equal(seconds('01:01:01,123'), 3661.123);
  /* A dot instead of a comma is invalid SRT, and some tools write it anyway.
     Reading it is kind; writing it is not. */
  assert.equal(seconds('00:00:02.250'), 2.25);
  assert.equal(seconds('nonsense'), null);
});

test('milliseconds are truncated, never rounded up', () => {
  /* Rounding up starts a cue before the word is spoken. At 25 frames a second
     that is a visible early flash. */
  assert.equal(stamp(1.0009), '00:00:01,000');
});

test('cues round-trip through a file', () => {
  const cues = [
    { start: 0.2, end: 2.4, text: 'First line' },
    { start: 2.5, end: 4, text: 'Second\nwith two lines' },
  ];
  const parsed = fromSrt(toSrt(cues));
  assert.equal(parsed.length, 2);
  assert.deepEqual(
    parsed.map(cue => [cue.start, cue.end, cue.text]),
    cues.map(cue => [cue.start, cue.end, cue.text]),
  );
  assert.deepEqual(parsed.map(cue => cue.declaredIndex), [1, 2]);
});

test('parsing tolerates CRLF, a BOM and extra blank lines', () => {
  const file = '﻿1\r\n00:00:00,000 --> 00:00:01,000\r\nHello\r\n\r\n\r\n2\r\n00:00:01,100 --> 00:00:02,000\r\nWorld\r\n';
  const cues = fromSrt(file);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hello');
  assert.equal(cues[1].start, 1.1);
});
