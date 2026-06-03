import { encode } from '@stablelib/base64';

import { ensureDbReady } from '@/worker/db';
import {
  getChatEntityAppearancesByChatNodePartId,
  getChatNodePartWithParentVisualById
} from '@/worker/db/models/chat-node-part/get-chat-node-part';
import { updateChatNodePartById } from '@/worker/db/models/chat-node-part/update-chat-node-part';

import { resolveArtStyle } from '../../lib/media/art-style';
import {
  compositeCrops,
  compositeCropsWithReference,
  loadCharacterCrops
} from '../../lib/media/character-crops';
import { generateOneShotImage } from '../../lib/media/generate-one-shot-image';
import { assemblePrompt, type StructuredPrompt } from '../../lib/media/image-models';
import { buildAssetUrl, parseAssetUrl } from '../../lib/media/transform-url';
import { getChatImageProvider } from '../../worker/providers';

export async function generateChatImage({
  chatMessagePartId
}: {
  chatMessagePartId: string;
}): Promise<string> {
  await ensureDbReady();

  const chatMessagePart = await getChatNodePartWithParentVisualById(chatMessagePartId);
  if (!chatMessagePart) throw new Error('Chat message part not found');
  if (chatMessagePart.contentUrl) return chatMessagePart.contentUrl;
  if (!chatMessagePart.content) {
    throw new Error('Chat message part has no content to use as prompt');
  }

  return chatMessagePart.parentVisualContentUrl
    ? continueScene(
        chatMessagePartId,
        chatMessagePart.parentVisualContentUrl,
        chatMessagePart.content,
        chatMessagePart.currentImageModel
      )
    : startScene(
        chatMessagePartId,
        chatMessagePart.content,
        chatMessagePart.currentImageModel
      );
}

async function startScene(
  chatMessagePartId: string,
  content: string,
  imageModelKey: string | null
): Promise<string> {
  const { entitiesWithImages, entitiesWithoutImages, artStyle } =
    await loadSceneEntities(chatMessagePartId);

  const characterCrops =
    entitiesWithImages.length > 0 ? await loadCharacterCrops(entitiesWithImages) : [];

  const refImages: { data: string; mimeType: 'image/png' }[] = [];
  if (characterCrops.length > 0) {
    const compositeBase64 = await compositeCrops(
      characterCrops.map((c) => c.croppedImage),
      16 / 9
    );
    refImages.push({ data: compositeBase64, mimeType: 'image/png' });
  }

  const prompt: StructuredPrompt = {
    prefix: renderCharacterBlock(
      characterCrops.map((c) => ({ name: c.bookEntityName, appearance: c.appearance })),
      entitiesWithoutImages.map((e) => ({ name: e.name, appearance: e.appearance }))
    ),
    content,
    suffix: `Rendered in a ${resolveArtStyle(artStyle)}.`
  };

  const image = await generateOneShotImage(getChatImageProvider(imageModelKey), {
    prompt: assemblePrompt(prompt),
    refImages,
    aspectRatio: '16:9'
  });

  return saveSceneImage(chatMessagePartId, image.data, image.mimeType);
}

async function continueScene(
  chatMessagePartId: string,
  parentVisualContentUrl: string,
  content: string,
  imageModelKey: string | null
): Promise<string> {
  const { relPath } = parseAssetUrl(parentVisualContentUrl);
  const refData = await host.fs.read(relPath);

  const { entitiesWithImages, entitiesWithoutImages } =
    await loadSceneEntities(chatMessagePartId);

  const characterCrops =
    entitiesWithImages.length > 0 ? await loadCharacterCrops(entitiesWithImages) : [];

  // Always bake chars + scene into a single reference image (maxReferenceImages: 1).
  const combinedBase64 =
    characterCrops.length === 0
      ? encode(refData)
      : await compositeCropsWithReference(
          await compositeCrops(characterCrops.map((c) => c.croppedImage)),
          refData,
          0.5
        );

  const prompt: StructuredPrompt = {
    prefix: renderCharacterBlock(
      characterCrops.map((c) => ({ name: c.bookEntityName, appearance: c.appearance })),
      entitiesWithoutImages.map((e) => ({ name: e.name, appearance: e.appearance }))
    ),
    content,
    // Art style is carried by the scene reference image; no explicit style suffix.
    suffix: ''
  };

  const image = await generateOneShotImage(getChatImageProvider(imageModelKey), {
    prompt: assemblePrompt(prompt),
    refImages: [{ data: combinedBase64, mimeType: 'image/png' }],
    aspectRatio: '16:9'
  });

  return saveSceneImage(chatMessagePartId, image.data, image.mimeType);
}

type CharInfo = { name: string; appearance: string };

async function loadSceneEntities(chatMessagePartId: string): Promise<{
  entitiesWithImages: {
    bookEntityName: string;
    croppedImageUrl: string;
    appearance: string;
  }[];
  entitiesWithoutImages: { name: string; appearance: string }[];
  artStyle: string | null;
}> {
  const result = await getChatEntityAppearancesByChatNodePartId(chatMessagePartId);
  const allEntities = result?.entityAppearances ?? [];
  const artStyle = result?.artStyle ?? null;

  const entitiesWithImages = allEntities
    .filter((e): e is typeof e & { imageUrl: string } => !!e.imageUrl)
    .map((e) => ({
      bookEntityName: e.name,
      croppedImageUrl: e.imageUrl,
      appearance: e.appearance
    }));

  const entitiesWithoutImages = allEntities
    .filter((e) => !e.imageUrl)
    .map((e) => ({ name: e.name, appearance: e.appearance }));

  return { entitiesWithImages, entitiesWithoutImages, artStyle };
}

function renderCharacterBlock(
  charactersInComposite: CharInfo[],
  charactersWithoutImages: CharInfo[]
): string {
  const parts: string[] = [];

  if (charactersInComposite.length > 0) {
    const list = charactersInComposite
      .map((c) => `${c.name}: ${c.appearance}`)
      .join('\n');
    parts.push(
      charactersInComposite.length === 1
        ? `Character in the reference image:\n${list}`
        : `Characters in the reference image (left to right):\n${list}`
    );
  }

  if (charactersWithoutImages.length > 0) {
    const list = charactersWithoutImages
      .map((c) => `${c.name}: ${c.appearance}`)
      .join('\n');
    const header =
      charactersInComposite.length > 0
        ? 'Also in the scene (no reference image available):'
        : `${charactersWithoutImages.length === 1 ? 'Character' : 'Characters'} in the scene:`;
    parts.push(`${header}\n${list}`);
  }

  return parts.join('\n\n');
}

async function saveSceneImage(
  chatMessagePartId: string,
  imageData: Uint8Array,
  imageMimeType: string
): Promise<string> {
  const key = `chat-images/${chatMessagePartId}`;
  const imageUrl = buildAssetUrl(key, imageMimeType);
  const { relPath } = parseAssetUrl(imageUrl);
  await host.fs.write(relPath, imageData);
  await updateChatNodePartById(chatMessagePartId, { contentUrl: imageUrl });
  return imageUrl;
}
