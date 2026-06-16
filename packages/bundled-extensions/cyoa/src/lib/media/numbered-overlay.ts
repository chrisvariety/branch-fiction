import { Jimp, JimpInstance, measureText, measureTextHeight } from 'jimp';
import polylabel from 'polylabel';

import { Point } from '@/lib/db/types';

import { loadBundledFont } from './font';

// Create a numbered overlay image showing areas with colored outlines
// Works directly on the source image (caller handles cropping if needed)

// Convert HSL to RGB hex color (Jimp format: 0xRRGGBBAA)
function hslToRgbHex(h: number, s: number, l: number): number {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0));
  const g = Math.round(255 * f(8));
  const b = Math.round(255 * f(4));
  return ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0; // RGBA format, >>> 0 converts to unsigned
}

export async function createNumberedOverlayImage(
  sourceImage:
    | Awaited<ReturnType<typeof Jimp.read>>
    | ReturnType<Awaited<ReturnType<typeof Jimp.read>>['crop']>,
  items: Array<{
    points: Point[];
    number: number;
  }>
): Promise<string> {
  // Clone the source image to avoid modifying the original
  const image = sourceImage.clone();

  const font = await loadBundledFont();

  // Generate 30 rainbow colors using golden angle for maximum distribution
  // The golden angle (~137.5°) ensures adjacent numbers get very different colors
  const rainbowColors: number[] = [];
  const goldenAngle = 137.508; // Golden angle in degrees
  for (let i = 0; i < 30; i++) {
    const hue = (i * goldenAngle) % 360; // Use golden angle to spread colors
    rainbowColors.push(hslToRgbHex(hue, 100, 50)); // Full saturation, medium lightness
  }

  // Helper function: Check if a point is inside a polygon (ray casting algorithm)
  function isPointInPolygon(x: number, y: number, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x,
        yi = polygon[i].y;
      const xj = polygon[j].x,
        yj = polygon[j].y;

      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Helper function: Blend foreground color with background using alpha blending
  function blendColors(bgColor: number, fgColor: number): number {
    // Extract RGBA components
    const bgR = (bgColor >> 24) & 0xff;
    const bgG = (bgColor >> 16) & 0xff;
    const bgB = (bgColor >> 8) & 0xff;

    const fgR = (fgColor >> 24) & 0xff;
    const fgG = (fgColor >> 16) & 0xff;
    const fgB = (fgColor >> 8) & 0xff;
    const fgA = fgColor & 0xff;

    // Alpha blending
    const alpha = fgA / 255;
    const outR = Math.round(fgR * alpha + bgR * (1 - alpha));
    const outG = Math.round(fgG * alpha + bgG * (1 - alpha));
    const outB = Math.round(fgB * alpha + bgB * (1 - alpha));
    const outA = 0xff; // Full opacity

    return ((outR << 24) | (outG << 16) | (outB << 8) | outA) >>> 0; // >>> 0 converts to unsigned
  }

  // Draw fills, outlines, and numbers for each item
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    const outlineColor = rainbowColors[itemIndex % rainbowColors.length];

    const points = item.points;

    // Fill polygon with semi-transparent color (20% opacity)
    const fillColor = ((outlineColor & 0xffffff00) | 0x33) >>> 0; // ~20% alpha (51/255), >>> 0 ensures unsigned

    // Get bounding box for this polygon
    const minX = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x))));
    const maxX = Math.min(
      image.bitmap.width - 1,
      Math.ceil(Math.max(...points.map((p) => p.x)))
    );
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
    const maxY = Math.min(
      image.bitmap.height - 1,
      Math.ceil(Math.max(...points.map((p) => p.y)))
    );

    // Fill all pixels inside the polygon
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (isPointInPolygon(x, y, points)) {
          const bgColor = image.getPixelColor(x, y);
          const blendedColor = blendColors(bgColor, fillColor);
          image.setPixelColor(blendedColor, x, y);
        }
      }
    }

    // Draw outline
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];

      // Simple line drawing
      const steps = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));

      for (let step = 0; step <= steps; step++) {
        const t = steps === 0 ? 0 : step / steps;
        const x = Math.round(p1.x + t * (p2.x - p1.x));
        const y = Math.round(p1.y + t * (p2.y - p1.y));

        if (x >= 0 && x < image.bitmap.width && y >= 0 && y < image.bitmap.height) {
          // Draw thick line (3 pixels)
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const px = x + dx;
              const py = y + dy;
              if (
                px >= 0 &&
                px < image.bitmap.width &&
                py >= 0 &&
                py < image.bitmap.height
              ) {
                image.setPixelColor(outlineColor, px, py);
              }
            }
          }
        }
      }
    }

    // Find the visual center (pole of inaccessibility) - the point inside the polygon
    // that's farthest from any edge, ensuring the number is always inside the shape
    const polygonCoords = points.map((p) => [p.x, p.y]);
    const [centerX, centerY] = polylabel([polygonCoords], 1.0);

    // Draw numbered circle with matching border color
    // Scale circle radius based on image dimensions
    // Base size: 25px for 1536x2752 reference (area ~4.2M pixels)
    const referenceArea = 1536 * 2752; // ~4.2M pixels
    const imageArea = image.bitmap.width * image.bitmap.height;
    const scaleFactor = Math.sqrt(imageArea / referenceArea);
    const circleRadius = Math.max(10, Math.round(25 * scaleFactor)); // Min 10px
    const circleColor = 0xffffffff; // White
    const borderColor = outlineColor; // Match the outline color
    const borderWidth = Math.max(2, Math.round(5 * scaleFactor)); // Scale border too, min 2px

    // Draw white circle
    for (let angle = 0; angle < 360; angle += 1) {
      const rad = (angle * Math.PI) / 180;
      for (let r = 0; r <= circleRadius; r++) {
        const x = Math.round(centerX + r * Math.cos(rad));
        const y = Math.round(centerY + r * Math.sin(rad));
        if (x >= 0 && x < image.bitmap.width && y >= 0 && y < image.bitmap.height) {
          image.setPixelColor(circleColor, x, y);
        }
      }
    }

    // Draw colored border
    for (let angle = 0; angle < 360; angle += 1) {
      const rad = (angle * Math.PI) / 180;
      for (let t = 0; t < borderWidth; t++) {
        const r = circleRadius - t;
        const x = Math.round(centerX + r * Math.cos(rad));
        const y = Math.round(centerY + r * Math.sin(rad));
        if (x >= 0 && x < image.bitmap.width && y >= 0 && y < image.bitmap.height) {
          image.setPixelColor(borderColor, x, y);
        }
      }
    }

    // Draw number text (centered)
    const numberStr = item.number.toString();
    const textWidth = measureText(font, numberStr);
    const textHeight = measureTextHeight(font, numberStr, image.bitmap.width);
    const textX = centerX - textWidth / 2;
    const textY = centerY - textHeight / 2;

    image.print({ font, x: textX, y: textY, text: numberStr });
  }

  // Convert to base64
  const outputBuffer = await (image as JimpInstance).getBuffer('image/png');
  return outputBuffer.toString('base64');
}
