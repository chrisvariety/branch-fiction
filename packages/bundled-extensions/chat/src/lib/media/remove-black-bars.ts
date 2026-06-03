import { Jimp } from 'jimp';

import { JimpImage } from './bounding-box';

// Maximum percentage of image height that can be black bars (per side).
// Prevents cropping too aggressively on very dark images.
const MAX_BAR_PERCENT = 0.25;

// Tolerance for "near-black" pixels (0-255 per channel)
const DARK_TOLERANCE = 20;

// Fraction of pixels in a row that must be near-black to count as a bar row
const ROW_THRESHOLD = 0.95;

function isPixelNearBlack(color: number): boolean {
  const r = (color >> 24) & 0xff;
  const g = (color >> 16) & 0xff;
  const b = (color >> 8) & 0xff;
  return r <= DARK_TOLERANCE && g <= DARK_TOLERANCE && b <= DARK_TOLERANCE;
}

function isRowNearBlack(image: JimpImage, y: number): boolean {
  const width = image.width;
  let darkCount = 0;

  for (let x = 0; x < width; x++) {
    if (isPixelNearBlack(image.getPixelColor(x, y))) {
      darkCount++;
    }
  }

  return darkCount / width >= ROW_THRESHOLD;
}

function detectTopBlackRows(image: JimpImage): number {
  const maxRows = Math.floor(image.height * MAX_BAR_PERCENT);
  let count = 0;
  for (let y = 0; y < maxRows; y++) {
    if (isRowNearBlack(image, y)) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function detectBottomBlackRows(image: JimpImage): number {
  const maxRows = Math.floor(image.height * MAX_BAR_PERCENT);
  let count = 0;
  for (let y = image.height - 1; y >= image.height - maxRows; y--) {
    if (isRowNearBlack(image, y)) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// Detects and removes black (letterbox) bars from the top and bottom of an image.
// Returns the cropped image data as a Uint8Array, or the original if no bars detected.
export async function removeBlackBars(imageData: Uint8Array): Promise<Uint8Array> {
  const image = (await Jimp.read(imageData.slice().buffer)) as JimpImage;

  const top = detectTopBlackRows(image);
  const bottom = detectBottomBlackRows(image);

  if (top === 0 && bottom === 0) {
    return imageData;
  }

  const newHeight = image.height - top - bottom;
  const cropped = image.crop({ x: 0, y: top, w: image.width, h: newHeight });
  const buffer = await cropped.getBuffer('image/png');
  return new Uint8Array(buffer);
}
