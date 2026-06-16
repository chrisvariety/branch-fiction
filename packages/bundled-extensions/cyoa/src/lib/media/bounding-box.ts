import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';
import { Jimp } from 'jimp';

import { Point } from '@/lib/db/types';

export type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

// Crop image to polygon shape (with transparency outside polygon).
// Returns the cropped Jimp image.
export function cropToPolygon(sourceImage: JimpImage, points: Point[]) {
  const bbox = getBoundingBox(points);

  // Crop to bounding box first
  const cropped = sourceImage.clone().crop({
    x: bbox.x,
    y: bbox.y,
    w: bbox.width,
    h: bbox.height
  });

  // Translate polygon points to cropped image coordinates
  const translatedPoints = points.map((p) => ({
    x: p.x - bbox.x,
    y: p.y - bbox.y
  }));

  // Create Turf polygon for point-in-polygon testing
  const turfPolygon = polygon([
    [...pointsToCoords(translatedPoints), pointsToCoords(translatedPoints)[0]]
  ]);

  // Scan through each pixel and set to transparent if outside polygon
  cropped.scan(0, 0, bbox.width, bbox.height, (x, y, idx) => {
    const pt = point([x, y]);
    if (!booleanPointInPolygon(pt, turfPolygon)) {
      // Set pixel to transparent
      cropped.bitmap.data[idx + 3] = 0; // Alpha channel
    }
  });

  return cropped;
}

// Calculate bounding box from a polygon
export function getBoundingBox(points: Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

// Convert Point[] array to GeoJSON coordinate array for Turf.js
function pointsToCoords(points: Point[]): Array<[number, number]> {
  return points.map((p) => [p.x, p.y]);
}

// Calculate the area of a polygon using the Shoelace formula
export function calculatePolygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

// Convert a bounding box to a square by expanding the smaller dimension.
// Centers the expansion so the original content remains centered.
export function makeSquare(bbox: {
  x: number;
  y: number;
  width: number;
  height: number;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const size = Math.max(bbox.width, bbox.height);

  // Center the square around the original bbox center
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;

  return {
    x: Math.round(centerX - size / 2),
    y: Math.round(centerY - size / 2),
    width: size,
    height: size
  };
}

// Expand a bounding box by a percentage on all sides.
export function expandBoundingBox(
  bbox: { x: number; y: number; width: number; height: number },
  percent: number
): { x: number; y: number; width: number; height: number } {
  const expandX = Math.round(bbox.width * percent);
  const expandY = Math.round(bbox.height * percent);

  return {
    x: bbox.x - expandX,
    y: bbox.y - expandY,
    width: bbox.width + expandX * 2,
    height: bbox.height + expandY * 2
  };
}
