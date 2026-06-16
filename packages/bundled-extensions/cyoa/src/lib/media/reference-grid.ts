import { encode } from '@stablelib/base64';
import { Jimp, measureText } from 'jimp';

import { loadBundledFont } from './font';

// Creates a grid layout of character reference images with labels.
// Dynamically calculates cell sizes based on actual image dimensions.
//
// Caller is responsible for loading the reference image bytes (from
// `host.fs.read(...)` or wherever) and passing them in directly.
export async function createCharacterReferenceGrid(
  characters: Array<{ name: string; imageBytes: Uint8Array; mimeType?: string }>
): Promise<{
  gridBase64: string;
  individualImages: Array<{ base64: string; mimeType: string }>;
}> {
  const COLUMNS = 4;
  const LABEL_HEIGHT = 128;
  const PADDING = 20;
  const TARGET_IMAGE_WIDTH = 512;

  const fetchedImages = await Promise.all(
    characters.map(async (character) => {
      const charImage = await Jimp.read(character.imageBytes.slice().buffer);
      return {
        name: character.name,
        image: charImage,
        originalWidth: charImage.width,
        originalHeight: charImage.height,
        base64: encode(character.imageBytes),
        mimeType: character.mimeType ?? 'image/png'
      };
    })
  );

  if (fetchedImages.length === 0) {
    throw new Error('No valid images to create grid');
  }

  const scaledImages = fetchedImages.map((img) => {
    const scale = TARGET_IMAGE_WIDTH / img.originalWidth;
    const scaledHeight = Math.round(img.originalHeight * scale);
    return {
      ...img,
      scaledWidth: TARGET_IMAGE_WIDTH,
      scaledHeight
    };
  });

  const maxScaledHeight = Math.max(...scaledImages.map((img) => img.scaledHeight));

  const CELL_WIDTH = TARGET_IMAGE_WIDTH + PADDING * 2;
  const CELL_HEIGHT = maxScaledHeight + LABEL_HEIGHT + PADDING * 2;

  const rows = Math.ceil(scaledImages.length / COLUMNS);
  const cols = Math.min(scaledImages.length, COLUMNS);
  const canvasWidth = cols * CELL_WIDTH;
  const canvasHeight = rows * CELL_HEIGHT;

  const canvas = new Jimp({
    width: canvasWidth,
    height: canvasHeight,
    color: 0xffffffff
  });

  const font = await loadBundledFont();

  for (let i = 0; i < scaledImages.length; i++) {
    const imgData = scaledImages[i];
    const row = Math.floor(i / COLUMNS);
    const col = i % COLUMNS;
    const x = col * CELL_WIDTH;
    const y = row * CELL_HEIGHT;

    const charImage = imgData.image.clone();
    charImage.resize({ w: imgData.scaledWidth, h: imgData.scaledHeight });

    const imageX = x + PADDING + (TARGET_IMAGE_WIDTH - imgData.scaledWidth) / 2;
    const imageY = y + PADDING + (maxScaledHeight - imgData.scaledHeight);

    canvas.composite(charImage, imageX, imageY);

    const labelY = y + PADDING + maxScaledHeight;
    const textWidth = measureText(font, imgData.name);
    const textX = x + (CELL_WIDTH - textWidth) / 2;
    const textY = labelY + (LABEL_HEIGHT - 32) / 2;

    canvas.print({ font, x: textX, y: textY, text: imgData.name });
  }

  const outputBuffer = await canvas.getBuffer('image/png');
  const gridBase64 = encode(outputBuffer);

  const individualImages = scaledImages.map((img) => ({
    base64: img.base64,
    mimeType: img.mimeType
  }));

  return { gridBase64, individualImages };
}
