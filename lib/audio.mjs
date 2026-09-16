import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Everything that touches the media file. ffmpeg does the work.
 *
 * ffmpeg is the only thing this tool needs installed that npm cannot provide.
 * `brew install ffmpeg`, `apt install ffmpeg`, or the build for your platform.
 */

const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function requireFfmpeg() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      run(tool, ['-version']);
    } catch {
      throw new Error(
        `${tool} is not installed, or not on PATH. Install it with \`brew install ffmpeg\` ` +
          '(macOS) or `apt install ffmpeg` (Debian, Ubuntu).',
      );
    }
  }
}

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi'];
export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg'];

/** Seconds, from the container. */
export function duration(file) {
  const out = run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read a duration from ${file}`);
  return seconds;
}

/**
 * Find the video the user meant.
 *
 * The point is that nobody should have to move a file to use this tool. Pass a
 * path to a file, pass a directory, or pass nothing at all and let it look in
 * the places a video is normally sitting after a download or an export. It
 * returns candidates, newest first, and the caller decides.
 */
export function findVideos(target) {
  const searched = [];

  if (target) {
    const resolved = path.resolve(target);
    if (!existsSync(resolved)) throw new Error(`No such file or directory: ${target}`);
    if (statSync(resolved).isFile()) return { candidates: [resolved], searched: [resolved] };
    searched.push(resolved);
  } else {
    /* The four places a video is, in the order it is likely to be the one you
       just made: the project, an explicit media folder, the browser's
       download folder, the desktop, the system video folder. */
    searched.push(
      process.cwd(),
      path.join(process.cwd(), 'media'),
      path.join(homedir(), 'Downloads'),
      path.join(homedir(), 'Desktop'),
      path.join(homedir(), 'Movies'),
      path.join(homedir(), 'Videos'),
    );
  }

  const candidates = [];
  for (const directory of searched) {
    if (!existsSync(directory) || !statSync(directory).isDirectory()) continue;
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      const extension = path.extname(name).toLowerCase();
      if (![...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].includes(extension)) continue;
      let info;
      try {
        info = statSync(file);
      } catch {
        continue;
      }
      if (info.isFile()) candidates.push({ file, modified: info.mtimeMs });
    }
  }

  candidates.sort((a, b) => b.modified - a.modified);
  return { candidates: candidates.map(entry => entry.file), searched };
}

/**
 * Audio for transcription, as small as it can be without losing words.
 *
 * Mono, 16 kHz, 64 kbps. Speech recognition models downsample to 16 kHz
 * anyway, and a second channel carries no information a transcriber uses. A 36
 * second clip comes out at 281 KB, an hour at about 28 MB. Uploading the
 * original video instead would send a hundred times the bytes for the same
 * transcript.
 *
 * An input that is already audio is re-encoded to the same shape rather than
 * passed through, so the size guarantee holds whatever was handed in.
 */
export function extractAudio(input, workDir) {
  mkdirSync(workDir, { recursive: true });
  const output = path.join(workDir, `${path.basename(input, path.extname(input))}.mp3`);
  run('ffmpeg', [
    '-y', '-v', 'error',
    '-i', input,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'libmp3lame',
    '-b:a', '64k',
    output,
  ]);
  return output;
}

/**
 * Split audio into chunks under a size limit.
 *
 * A transcription API takes a file, not a stream, and every one of them caps
 * the upload. An hour of speech is about 28 MB at the settings above, which is
 * over some limits and under others.
 *
 * The offsets are measured from the produced files rather than assumed from
 * the requested segment length. `-c copy` cuts on frame boundaries, so a
 * "fifteen minute" chunk is fifteen minutes and a fraction. Assuming the
 * requested length drifts the timestamps of every chunk after the first, and
 * the drift accumulates: the last cue of a long video ends up seconds away
 * from the words it belongs to.
 */
export function splitAudio(file, workDir, { maxBytes = 20 * 1024 * 1024, seconds = 900 } = {}) {
  if (statSync(file).size <= maxBytes) return [{ file, offset: 0 }];

  const directory = path.join(workDir, 'chunks');
  mkdirSync(directory, { recursive: true });
  run('ffmpeg', [
    '-y', '-v', 'error',
    '-i', file,
    '-f', 'segment',
    '-segment_time', String(seconds),
    '-c', 'copy',
    path.join(directory, 'chunk-%03d.mp3'),
  ]);

  const chunks = readdirSync(directory)
    .filter(name => name.endsWith('.mp3'))
    .sort()
    .map(name => path.join(directory, name));

  let offset = 0;
  return chunks.map(chunk => {
    const entry = { file: chunk, offset };
    offset += duration(chunk);
    return entry;
  });
}
