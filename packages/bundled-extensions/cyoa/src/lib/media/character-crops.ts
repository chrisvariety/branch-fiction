import { parseAssetUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import { Jimp } from 'jimp';

import { type WorkflowContext } from '@/worker/handler';

import {
  deduplicateByLabelCenter,
  RoboflowPrediction,
  SegmentationProvider,
  segmentImage
} from '../segment/prediction';
import { calculatePolygonArea, JimpImage } from './bounding-box';
import { DEBUG_MODE } from './debug';

export async function loadCharacterCrops<
  T extends { bookEntityName: string; croppedImageUrl?: string | null }
>(characterEntities: T[]): Promise<(T & { croppedImage: JimpImage })[]> {
  return Promise.all(
    characterEntities
      .filter((e) => e.croppedImageUrl)
      .map(async (e): Promise<T & { croppedImage: JimpImage }> => {
        const { relPath } = parseAssetUrl(e.croppedImageUrl!);
        const data = await host.fs.read(relPath);
        return {
          ...e,
          croppedImage: await Jimp.read(data.slice().buffer)
        };
      })
  );
}

// Segment an image, filter predictions by area/confidence, and deduplicate.
// Shared pipeline used by both generate-character-interactive and finalize-character-interactive.

export async function segmentAndFilter(
  provider: SegmentationProvider,
  imageData: Uint8Array,
  segmentClasses: string,
  ctx: WorkflowContext
): Promise<{
  predictions: RoboflowPrediction[];
  width: number;
  height: number;
}> {
  const { predictions, width, height } = await segmentImage(
    provider,
    imageData,
    segmentClasses,
    ctx
  );

  const MIN_POLYGON_AREA = 400;
  const MIN_CONFIDENCE_FOR_SMALL = 0.8;
  const SMALL_DETECTION_THRESHOLD = 1000;

  if (DEBUG_MODE) {
    console.log('\n=== PREDICTION FILTERING ===');
  }

  const filteredPredictions = predictions.filter((p, index) => {
    const area = calculatePolygonArea(p.points);

    let passed = area >= MIN_POLYGON_AREA;
    let reason = '';

    if (passed && area < SMALL_DETECTION_THRESHOLD) {
      if (p.confidence < MIN_CONFIDENCE_FOR_SMALL) {
        passed = false;
        reason = `(low conf for small area)`;
      }
    }

    if (DEBUG_MODE) {
      console.log(
        `#${index + 1}: ${passed ? '✓' : '✗'} | ` +
          `Area: ${area.toFixed(0)}px² | ` +
          `BBox: ${p.width.toFixed(0)}×${p.height.toFixed(0)} | ` +
          `Conf: ${(p.confidence * 100).toFixed(1)}% | ` +
          `Class: ${p.class}` +
          (reason ? ` ${reason}` : '')
      );
    }

    return passed;
  });

  if (DEBUG_MODE) {
    console.log(`\nFiltered: ${predictions.length} -> ${filteredPredictions.length}`);
  }

  ctx.log
    .withMetadata({
      totalPredictions: predictions.length,
      filteredPredictions: filteredPredictions.length
    })
    .info('Filtered segmentation predictions');

  const mergedPredictions = deduplicateByLabelCenter(filteredPredictions);

  ctx.log
    .withMetadata({
      beforeMerge: filteredPredictions.length,
      afterMerge: mergedPredictions.length
    })
    .info('Merged overlapping predictions');

  return { predictions: mergedPredictions, width, height };
}

/**
 * Composite cropped images side-by-side.
 * Returns base64 encoded PNG with alpha channel.
 */
export async function compositeCrops(
  cropImages: JimpImage[],
  aspectRatio?: number
): Promise<string> {
  // Calculate composite dimensions
  const totalWidth = cropImages.reduce((sum, img) => sum + img.width, 0);
  const maxHeight = Math.max(...cropImages.map((img) => img.height));

  let canvasWidth = totalWidth;
  let canvasHeight = maxHeight;

  if (aspectRatio) {
    const currentRatio = totalWidth / maxHeight;
    if (currentRatio > aspectRatio) {
      // Too wide — increase height
      canvasHeight = Math.round(totalWidth / aspectRatio);
    } else if (currentRatio < aspectRatio) {
      // Too tall — increase width
      canvasWidth = Math.round(maxHeight * aspectRatio);
    }
  }

  // Create composite image (transparent background)
  const composite = new Jimp({
    width: canvasWidth,
    height: canvasHeight,
    color: 0x00000000
  });

  // Center the crops within the canvas
  const xStart = Math.round((canvasWidth - totalWidth) / 2);
  const yStart = Math.round((canvasHeight - maxHeight) / 2);

  // Place images side by side
  let xOffset = xStart;
  for (const img of cropImages) {
    composite.composite(img, xOffset, yStart);
    xOffset += img.width;
  }

  const buffer = await composite.getBuffer('image/png');
  return buffer.toString('base64');
}

// Composite character crops with a reference image side-by-side.
// Crops appear on the left, reference image on the right scaled to fit the crops height.
// `referenceScale` (0–1, default 1) shrinks the reference further and centers it vertically.
// Returns base64 encoded PNG.
export async function compositeCropsWithReference(
  cropsBase64: string,
  refData: Uint8Array,
  referenceScale = 1
): Promise<string> {
  const cropsImage = await Jimp.read(Buffer.from(cropsBase64, 'base64'));
  const refImage = await Jimp.read(refData.slice().buffer);

  const scale = (cropsImage.height / refImage.height) * referenceScale;
  refImage.scale(scale);

  const canvasWidth = cropsImage.width + refImage.width;
  const canvasHeight = cropsImage.height;

  const composite = new Jimp({
    width: canvasWidth,
    height: canvasHeight,
    color: 0x00000000
  });

  const refY = Math.round((canvasHeight - refImage.height) / 2);

  composite.composite(cropsImage, 0, 0);
  composite.composite(refImage, cropsImage.width, refY);

  const buffer = await composite.getBuffer('image/png');
  return buffer.toString('base64');
}

// Contain an image within the given aspect ratio by padding with white.
export async function containToAspectRatio(
  img: { base64Data: string; mimeType: string },
  aspectRatio: number
): Promise<{ base64Data: string; mimeType: string }> {
  const image = await Jimp.read(Buffer.from(img.base64Data, 'base64'));
  const { width, height } = image;
  const currentRatio = width / height;

  if (Math.abs(currentRatio - aspectRatio) < 0.01) return img;

  let canvasW: number;
  let canvasH: number;

  if (currentRatio > aspectRatio) {
    canvasW = width;
    canvasH = Math.round(width / aspectRatio);
  } else {
    canvasH = height;
    canvasW = Math.round(height * aspectRatio);
  }

  const canvas = new Jimp({ width: canvasW, height: canvasH, color: 0xffffffff });
  const x = Math.round((canvasW - width) / 2);
  const y = Math.round((canvasH - height) / 2);
  canvas.composite(image, x, y);

  const buffer = await canvas.getBuffer('image/jpeg');
  return { base64Data: buffer.toString('base64'), mimeType: 'image/jpeg' };
}
