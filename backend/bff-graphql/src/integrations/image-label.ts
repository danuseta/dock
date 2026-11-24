import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** One image of a post: its number in the text, its file in the screenshots folder and the short caption stamped above it. */
export interface PostImage { n: number; file: string; caption: string }

/** Stamps a labelled copy of `input` to `output`; `data` is the input's bytes. Throws when no copy was made. */
export type ImageStamper = (input: string, output: string, image: PostImage, data: Buffer) => Promise<void>;

const STRIP_COLOR = '0xF5B041';
const TEXT_COLOR = '0x1A1306';
const BASE_WIDTH = 1440;
const STAMP_TIMEOUT_MS = 20_000;
const LINUX_FONTS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];
const WINDOWS_FONT = 'C:/Windows/Fonts/arialbd.ttf';

/** The pixel width in a PNG, GIF, WebP or JPEG header; null when the bytes do not say. */
export function imageWidth(data: Buffer): number | null {
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47) return data.readUInt32BE(16);
  if (data.length >= 10 && data.subarray(0, 3).toString('latin1') === 'GIF') return data.readUInt16LE(6);
  if (data.length >= 30 && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    const chunk = data.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8 ') return data.readUInt16LE(26) & 0x3fff;
    if (chunk === 'VP8L') return (data.readUInt32LE(21) & 0x3fff) + 1;
    if (chunk === 'VP8X') return data.readUIntLE(24, 3) + 1;
    return null;
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) {
        at += 1;
        continue;
      }
      const marker = data[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return data.readUInt16BE(at + 7);
      at += 2 + data.readUInt16BE(at + 2);
    }
  }
  return null;
}

/** Sizes of the strip for an image width: a 1440 px screenshot gets an 84 px strip with 40 px and 26 px text. */
export function labelLayout(width: number, n: number) {
  const scale = Math.min(3, Math.max(0.5, width / BASE_WIDTH));
  const strip = 2 * Math.round(42 * scale);
  const title = Math.round(40 * scale);
  const caption = Math.round(26 * scale);
  const margin = Math.round(24 * scale);
  const captionX = margin + Math.ceil(`GAMBAR ${n}`.length * title * 0.68) + margin;
  const maxChars = Math.max(0, Math.floor((width - captionX - margin) / (caption * 0.56)));
  return { strip, title, caption, margin, captionX, maxChars, baseline: Math.round(strip / 2 + title * 0.36) };
}

/** A caption on one line, cut with an ellipsis to `max` characters. */
export function fitCaption(caption: string, max: number): string {
  const line = caption.replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  return max > 1 ? `${line.slice(0, max - 1).trimEnd()}…` : '';
}

/** A drawtext option value: `\`, `'`, `:` and `%` escaped for the option, then `\`, `'`, `[`, `]`, `,` and `;` for the filter graph. */
export const drawtextValue = (value: string) => value.replace(/[\\':%]/g, '\\$&').replace(/[\\'[\],;]/g, '\\$&');

/** The ffmpeg arguments that add the yellow strip with "GAMBAR N" and the caption above an image. */
export function stampArgs(input: { source: string; output: string; font: string; width: number; image: PostImage }): string[] {
  const { source, output, font, width, image } = input;
  const layout = labelLayout(width, image.n);
  const caption = fitCaption(image.caption, layout.maxChars);
  const text = (value: string, size: number, x: number) =>
    `drawtext=fontfile=${drawtextValue(font)}:expansion=none:text=${drawtextValue(value)}:fontsize=${size}:fontcolor=${TEXT_COLOR}:x=${x}:y=${layout.baseline}-ascent`;
  const filter = [
    `pad=iw:ih+${layout.strip}:0:${layout.strip}:color=${STRIP_COLOR}`,
    text(`GAMBAR ${image.n}`, layout.title, layout.margin),
    ...(caption ? [text(caption, layout.caption, layout.captionX)] : []),
  ].join(',');
  const quality = /\.jpe?g$/i.test(output) ? ['-q:v', '2'] : [];
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vf', filter, '-frames:v', '1', ...quality, output];
}

const exists = (file: string) => access(file).then(() => true, () => false);

let fontLookup: Promise<string | null> | null = null;

/** The bold font the label is drawn with: `DOCK_LABEL_FONT`, Arial Bold on Windows, DejaVu Sans Bold on Linux; null when none is found. */
export function labelFont(): Promise<string | null> {
  fontLookup ??= (async () => {
    const own = process.env.DOCK_LABEL_FONT?.trim();
    if (own && (await exists(own))) return own;
    if (process.platform === 'win32') return (await exists(WINDOWS_FONT)) ? WINDOWS_FONT : null;
    for (const file of LINUX_FONTS) if (await exists(file)) return file;
    const matched = await run('fc-match', ['-f', '%{file}', 'DejaVu Sans:style=Bold'], { timeout: 5_000 }).then(({ stdout }) => stdout.trim(), () => '');
    return matched && path.isAbsolute(matched) && (await exists(matched)) ? matched : null;
  })();
  const found = fontLookup;
  void found.then((font) => {
    if (!font && fontLookup === found) fontLookup = null;
  });
  return found;
}

/** The ffmpeg binary: `DOCK_FFMPEG`, else `~/.local/bin/ffmpeg` when it exists, else `ffmpeg` on PATH. */
async function ffmpegPath(): Promise<string> {
  const own = process.env.DOCK_FFMPEG?.trim();
  if (own) return own;
  const home = process.env.HOME || process.env.USERPROFILE;
  const local = home ? path.join(home, '.local', 'bin', 'ffmpeg') : '';
  return local && (await exists(local)) ? local : 'ffmpeg';
}

/** Stamps the label with ffmpeg, without a shell and with a timeout. */
export const stampImage: ImageStamper = async (source, output, image, data) => {
  const font = await labelFont();
  if (!font) throw new Error('No font for the image label');
  const args = stampArgs({ source, output, font, width: imageWidth(data) ?? BASE_WIDTH, image });
  await run(await ffmpegPath(), args, { timeout: STAMP_TIMEOUT_MS, windowsHide: true });
};
