import { encode } from '@stablelib/base64';
import { booleanIntersects } from '@turf/boolean-intersects';
import { booleanOverlap } from '@turf/boolean-overlap';
import { convex } from '@turf/convex';
import { featureCollection, point, polygon } from '@turf/helpers';
import { intersect } from '@turf/intersect';
import polylabel from 'polylabel';

import { Point } from '@/lib/db/types';
import { type WorkflowContext } from '@/worker/handler';

import { DEBUG_MODE } from '../media/debug';

export interface SegmentationProvider {
  apiKey: string;
  baseUrl: string;
}

export interface RoboflowPrediction {
  width: number;
  height: number;
  x: number;
  y: number;
  confidence: number;
  class_id: number;
  points: Point[];
  class: string;
  detection_id: string;
  parent_id: string;
}

interface RoboflowResult {
  outputs: Array<{
    sam: {
      image: {
        width: number;
        height: number;
      };
      predictions: RoboflowPrediction[];
    };
  }>;
}

export async function segmentImage(
  provider: SegmentationProvider,
  image: string | Uint8Array,
  prompt: string,
  ctx: WorkflowContext
): Promise<{
  predictions: RoboflowPrediction[];
  width: number;
  height: number;
}> {
  const imageBase64 = typeof image === 'string' ? image : encode(image);

  const maxRetries = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: provider.apiKey,
        inputs: {
          image: { type: 'base64', value: imageBase64 },
          prompts: prompt.split(',').map((p) => p.trim())
        }
      })
    });

    if (!response.ok) {
      lastError = new Error(
        `Roboflow API error: ${response.status} ${response.statusText}`
      );
      if (attempt < maxRetries) {
        ctx.log.info(
          `Roboflow API returned ${response.status}, retrying (attempt ${attempt + 1}/${maxRetries})`
        );
        continue;
      }
      throw lastError;
    }

    const result: RoboflowResult = await response.json();
    const predictions = result.outputs[0].sam.predictions;

    if (predictions.length > 0 && !predictions[0].points) {
      throw new Error(
        'Roboflow workflow is configured incorrectly: predictions are missing polygon points. ' +
          'Please change "Sam 3" -> "Additional Properties" -> "Output Format" from \'rle\' to \'polygons\'.'
      );
    }

    ctx.log
      .withMetadata({ predictionCount: predictions.length })
      .info('Roboflow segmentation complete');

    return {
      predictions,
      width: result.outputs[0].sam.image.width,
      height: result.outputs[0].sam.image.height
    };
  }

  throw lastError || new Error('Roboflow segmentation failed');
}

// Deduplicate predictions whose polylabel centers are within 10px, keeping the larger area.
export function deduplicateByLabelCenter(
  predictions: RoboflowPrediction[]
): RoboflowPrediction[] {
  if (predictions.length === 0) return [];

  const threshold = 10; // Fixed 10px threshold

  // Calculate center for each prediction using polylabel
  const predictionsWithCenters = predictions.map((prediction) => {
    const polygonCoords = prediction.points.map((p) => [p.x, p.y]);
    const [centerX, centerY] = polylabel([polygonCoords], 1.0);
    const area = calculatePolygonArea(prediction.points);
    return {
      prediction,
      center: { x: centerX, y: centerY },
      area
    };
  });

  // Sort by area descending so we keep larger predictions when deduping
  predictionsWithCenters.sort((a, b) => b.area - a.area);

  const kept: typeof predictionsWithCenters = [];
  const used = new Set<number>();

  for (let i = 0; i < predictionsWithCenters.length; i++) {
    if (used.has(i)) continue;

    const current = predictionsWithCenters[i];
    kept.push(current);
    used.add(i);

    // Mark any predictions with similar centers as used
    for (let j = i + 1; j < predictionsWithCenters.length; j++) {
      if (used.has(j)) continue;

      const other = predictionsWithCenters[j];
      const distance = Math.sqrt(
        Math.pow(current.center.x - other.center.x, 2) +
          Math.pow(current.center.y - other.center.y, 2)
      );

      if (distance < threshold) {
        used.add(j);
        if (DEBUG_MODE) {
          console.log(
            `Removing prediction with center at (${other.center.x.toFixed(0)}, ${other.center.y.toFixed(0)}) ` +
              `- too close to (${current.center.x.toFixed(0)}, ${current.center.y.toFixed(0)}) ` +
              `distance: ${distance.toFixed(1)}px`
          );
        }
      }
    }
  }

  return kept.map((item) => item.prediction);
}

// Merge intersecting predictions into convex-hull polygons; loses detail, not for general use.
export function smoothByMergingIntersections(
  predictions: RoboflowPrediction[],
  ctx: WorkflowContext,
  minOverlapRatio: number = 0
): RoboflowPrediction[] {
  if (predictions.length === 0) return [];

  const prepared = predictions.map((prediction) => {
    const coords = pointsToCoords(prediction.points);
    const bbox = getBoundingBox(prediction.points);
    if (coords.length < 3) {
      return {
        prediction,
        poly: null as ReturnType<typeof polygon> | null,
        bbox: {
          minX: bbox.x,
          minY: bbox.y,
          maxX: bbox.x + bbox.width,
          maxY: bbox.y + bbox.height
        }
      };
    }

    const first = coords[0];
    const ring = first ? [...coords, first] : coords;
    return {
      prediction,
      poly: polygon([ring]),
      bbox: {
        minX: bbox.x,
        minY: bbox.y,
        maxX: bbox.x + bbox.width,
        maxY: bbox.y + bbox.height
      }
    };
  });

  const parent = Array.from({ length: predictions.length }, (_, idx) => idx);
  const rank = new Array<number>(predictions.length).fill(0);

  const find = (idx: number): number => {
    let current = idx;
    while (parent[current] !== current) current = parent[current];
    let path = idx;
    while (parent[path] !== path) {
      const next = parent[path];
      parent[path] = current;
      path = next;
    }
    return current;
  };

  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;

    if (rank[rootA] < rank[rootB]) {
      parent[rootA] = rootB;
    } else if (rank[rootA] > rank[rootB]) {
      parent[rootB] = rootA;
    } else {
      parent[rootB] = rootA;
      rank[rootA]++;
    }
  };

  const bboxesIntersect = (
    a: { minX: number; minY: number; maxX: number; maxY: number },
    b: { minX: number; minY: number; maxX: number; maxY: number }
  ) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      if (!bboxesIntersect(prepared[i].bbox, prepared[j].bbox)) continue;
      const polyA = prepared[i].poly;
      const polyB = prepared[j].poly;
      if (!polyA || !polyB) continue;

      const geometricallyIntersects =
        booleanIntersects(polyA, polyB) || booleanOverlap(polyA, polyB);

      if (!geometricallyIntersects) continue;

      if (minOverlapRatio > 0) {
        const intersection = intersect(featureCollection([polyA, polyB]));
        if (!intersection) continue;

        // Calculate intersection area
        let intersectionArea = 0;
        const geom = intersection.geometry;
        if (geom.type === 'Polygon') {
          intersectionArea = calculatePolygonArea(
            coordsToPoints(geom.coordinates[0].slice(0, -1))
          );
        } else if (geom.type === 'MultiPolygon') {
          for (const ring of geom.coordinates) {
            intersectionArea += calculatePolygonArea(
              coordsToPoints(ring[0].slice(0, -1))
            );
          }
        }

        const areaA = calculatePolygonArea(predictions[i].points);
        const areaB = calculatePolygonArea(predictions[j].points);
        const smallerArea = Math.min(areaA, areaB);
        const overlapRatio = smallerArea > 0 ? intersectionArea / smallerArea : 0;

        if (DEBUG_MODE) {
          console.log(
            `Overlap: #${i}↔#${j} ratio=${(overlapRatio * 100).toFixed(1)}% ` +
              `(threshold=${(minOverlapRatio * 100).toFixed(1)}%) → ${overlapRatio >= minOverlapRatio ? 'MERGE' : 'SKIP'}`
          );
        }

        if (overlapRatio < minOverlapRatio) continue;
      }

      union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < predictions.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  }

  const merged: RoboflowPrediction[] = [];
  let mergedGroups = 0;

  for (const groupIndices of groups.values()) {
    if (groupIndices.length === 1) {
      merged.push(predictions[groupIndices[0]]);
      continue;
    }

    mergedGroups++;
    const groupPredictions = groupIndices.map((idx) => predictions[idx]);
    const allPoints = groupPredictions.flatMap((p) => p.points);

    const pointFeatures = featureCollection(allPoints.map((p) => point([p.x, p.y])));
    const hull = convex(pointFeatures);
    if (!hull) {
      merged.push(groupPredictions[0]);
      continue;
    }

    const hullCoords = hull.geometry.coordinates[0];
    const mergedPoints = coordsToPoints(hullCoords.slice(0, -1));
    const bbox = getBoundingBox(mergedPoints);

    let sumX = 0;
    let sumY = 0;
    for (const p of mergedPoints) {
      sumX += p.x;
      sumY += p.y;
    }

    const maxConfidence = Math.max(...groupPredictions.map((p) => p.confidence));

    merged.push({
      ...groupPredictions[0],
      x: sumX / mergedPoints.length,
      y: sumY / mergedPoints.length,
      width: bbox.width,
      height: bbox.height,
      points: mergedPoints,
      confidence: maxConfidence
    });
  }

  if (mergedGroups > 0) {
    ctx.log
      .withMetadata({
        inputCount: predictions.length,
        outputCount: merged.length,
        mergedGroups
      })
      .info('Merged intersecting predictions');
  }

  return merged;
}

// Universal Symmetrizer for place 'windows'
// Works for Arches, Squares, Trefoils, and anything with vertical symmetry.
export function symmetrizeShape(
  inputPolygon: Point[],
  numSteps: number = 80 // Higher steps = better detail for complex shapes like the trefoil
): Point[] {
  if (inputPolygon.length < 3) return inputPolygon;

  // 1. Calculate Bounds
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of inputPolygon) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const centerX = (minX + maxX) / 2;
  const leftEdge: Point[] = [];
  const rightEdge: Point[] = [];

  // 2. Scan from Top to Bottom
  // Note: We include step 0 to capture the flat top of squares correctly
  const stepSize = (maxY - minY) / numSteps;

  for (let i = 0; i <= numSteps; i++) {
    // Current Y position
    const currentY = Math.min(minY + i * stepSize, maxY - 0.1); // -0.1 ensures we stay inside bounds for the scanline

    const intersections = getIntersections(inputPolygon, currentY);

    // We need at least 2 hits (enter and exit) to define a width
    if (intersections.length < 2) continue;

    // Outer bounds: First hit is Left, Last hit is Right.
    // (This ignores internal holes, which is usually desired for window frames)
    const xLeft = intersections[0];
    const xRight = intersections[intersections.length - 1];

    // 3. Calculate Average Width from Center
    const distLeft = centerX - xLeft;
    const distRight = xRight - centerX;
    const avgRadius = (distLeft + distRight) / 2;

    // 4. Generate Symmetrical Points
    leftEdge.push({ x: centerX - avgRadius, y: currentY });
    rightEdge.push({ x: centerX + avgRadius, y: currentY });
  }

  // 5. Reconstruct and Close
  return [...leftEdge, ...rightEdge.reverse()];
}

function calculatePolygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

// Convert Point[] array to GeoJSON coordinate array for Turf.js
function pointsToCoords(points: Point[]): Array<[number, number]> {
  return points.map((p) => [p.x, p.y]);
}

// Convert GeoJSON coordinates back to Point[] array
// Handles both 2D and 3D positions (ignoring elevation if present)
function coordsToPoints(coords: number[][]): Point[] {
  return coords.map((coord) => ({ x: coord[0], y: coord[1] }));
}

// Calculate bounding box from a polygon
function getBoundingBox(points: Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.ceil(maxX) - Math.floor(minX),
    height: Math.ceil(maxY) - Math.floor(minY)
  };
}

// Standard Scanline Intersection
// Casts a horizontal line at 'y' and finds all x-intercepts with the polygon edges.
function getIntersections(polygon: Point[], y: number): number[] {
  const intersections: number[] = [];

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length]; // Wrap around to close polygon

    // Check if the horizontal line at 'y' intersects the edge (p1, p2)
    // We strictly check bounds to avoid double counting vertices
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);

    if (y >= minY && y < maxY) {
      // Calculate X intersection using linear interpolation
      const t = (y - p1.y) / (p2.y - p1.y);
      const x = p1.x + t * (p2.x - p1.x);
      intersections.push(x);
    }
  }

  return intersections.sort((a, b) => a - b);
}
