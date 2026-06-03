import { Jimp } from 'jimp';

import { calculatePolygonArea } from '@/lib/media/bounding-box';
import {
  RoboflowPrediction,
  SegmentationProvider,
  segmentImage,
  smoothByMergingIntersections
} from '@/lib/segment/prediction';
import { type WorkflowContext } from '@/worker/handler';

export const MIN_HEAD_POLYGON_AREA = 400;
export const MIN_HEAD_CONFIDENCE = 0.3;

// Flatten transparent pixels to white so the segmentation model
// can't see through alpha to the original image data beneath.
async function flattenAlphaToWhite(imageData: Uint8Array): Promise<Uint8Array> {
  const img = await Jimp.read(imageData.slice().buffer);
  let hasTransparency = false;

  img.scan(0, 0, img.width, img.height, (_x, _y, idx) => {
    if (img.bitmap.data[idx + 3] === 0) {
      hasTransparency = true;
      img.bitmap.data[idx] = 255;
      img.bitmap.data[idx + 1] = 255;
      img.bitmap.data[idx + 2] = 255;
      img.bitmap.data[idx + 3] = 255;
    }
  });

  if (!hasTransparency) return imageData;
  return new Uint8Array(await img.getBuffer('image/png'));
}

// Detect heads in an image using segmentation.
// Returns merged and filtered head predictions.
export async function detectHeads(
  provider: SegmentationProvider,
  imageData: Uint8Array,
  ctx: WorkflowContext,
  options?: {
    minArea?: number;
    minConfidence?: number;
  }
): Promise<RoboflowPrediction[]> {
  const minArea = options?.minArea ?? MIN_HEAD_POLYGON_AREA;
  const minConfidence = options?.minConfidence ?? MIN_HEAD_CONFIDENCE;

  const flattenedData = await flattenAlphaToWhite(imageData);
  const { predictions } = await segmentImage(provider, flattenedData, 'head', ctx);

  if (predictions.length === 0) {
    return [];
  }

  // Merge intersecting predictions (e.g., face + hair + horns into one complete head)
  const mergedPredictions = smoothByMergingIntersections(predictions, ctx);

  // Filter by area and confidence, sort largest first
  const validHeads = mergedPredictions
    .filter((p) => {
      const area = calculatePolygonArea(p.points);
      return area >= minArea && p.confidence >= minConfidence;
    })
    .sort((a, b) => calculatePolygonArea(b.points) - calculatePolygonArea(a.points));

  return validHeads;
}

// Detect heads using multiple fallback prompts.
// Tries 'head and shoulders' first, then 'head', then 'body'.
export async function detectHeadsWithFallback(
  provider: SegmentationProvider,
  imageData: Uint8Array,
  ctx: WorkflowContext,
  options?: {
    minArea?: number;
    minConfidence?: number;
    prompts?: string[];
  }
): Promise<RoboflowPrediction[]> {
  const minArea = options?.minArea ?? MIN_HEAD_POLYGON_AREA;
  const minConfidence = options?.minConfidence ?? MIN_HEAD_CONFIDENCE;
  const prompts = options?.prompts ?? ['head and shoulders', 'head', 'body'];

  const flattenedData = await flattenAlphaToWhite(imageData);
  let predictions: RoboflowPrediction[] = [];

  for (const prompt of prompts) {
    const result = await segmentImage(provider, flattenedData, prompt, ctx);
    if (result.predictions.length > 0) {
      predictions = result.predictions;
      break;
    }
  }

  if (predictions.length === 0) {
    return [];
  }

  // Merge intersecting predictions
  const mergedPredictions = smoothByMergingIntersections(predictions, ctx);

  // Filter by area and confidence, sort largest first
  const validPredictions = mergedPredictions
    .filter((p) => {
      const area = calculatePolygonArea(p.points);
      return area >= minArea && p.confidence >= minConfidence;
    })
    .sort((a, b) => calculatePolygonArea(b.points) - calculatePolygonArea(a.points));

  return validPredictions;
}
