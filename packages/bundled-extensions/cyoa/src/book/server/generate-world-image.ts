import { resolveArtStyle } from '@branch-fiction/extension-sdk/media/art-style';
import { type StructuredPrompt } from '@branch-fiction/extension-sdk/media/image-models';
import {
  buildAssetUrl,
  parseAssetUrl
} from '@branch-fiction/extension-sdk/media/transform-url';
import dedent from 'dedent';

import { ensureDbReady } from '@/worker/db';
import { getUserWorldWithEntitiesById } from '@/worker/db/models/user-world/get-user-world';
import { updateUserWorldById } from '@/worker/db/models/user-world/update-user-world';

import { compositeCrops, loadCharacterCrops } from '../../lib/media/character-crops';
import { generateImageWithSafetyRewrite } from '../../lib/media/rewrite-for-safety';
import { getProvider } from '../../worker/providers';

export type GenerateWorldImageParams = {
  userWorldId: string;
};

export async function generateWorldImage({
  userWorldId
}: GenerateWorldImageParams): Promise<string> {
  await ensureDbReady();
  const userWorld = await getUserWorldWithEntitiesById(userWorldId);
  if (!userWorld) throw new Error('User world not found');

  if (userWorld.imageUrl) {
    return userWorld.imageUrl;
  }

  const book = userWorld.books[0];
  if (!book) throw new Error('Book not found');

  const characterEntities = userWorld.bookInteractiveEntities.filter(
    (e) => e.bookEntityType === 'CHARACTER'
  );
  const placeEntity = userWorld.bookInteractiveEntities.find(
    (e) => e.bookEntityType === 'PLACE'
  );

  if (characterEntities.length === 0) throw new Error('No character entities found');
  if (!placeEntity) throw new Error('No place entity found');
  if (!placeEntity.bookArcContent) throw new Error('No place description found');

  const characterCrops = await loadCharacterCrops(characterEntities);

  const compositeBase64 = await compositeCrops(
    characterCrops.map((c) => c.croppedImage),
    16 / 9
  );

  const characterList = characterCrops
    .map((c, i) => `${i + 1}. ${c.bookEntityName}: ${c.bookArcContent}`)
    .join('\n');

  const prompt: StructuredPrompt = {
    prefix: dedent`
      Characters in the reference image (left to right):
      ${characterList}`,
    content: dedent`
      Integrate these characters in the following setting: ${placeEntity.bookArcContent}

      Integrate the characters naturally into the scene with fresh, dynamic poses that differ from the reference image. While maintaining each character's distinctive appearance and likeness, reposition and repose them to fit the environment and context naturally. Position and orient the characters as if they are at the start of a grand adventure - they should appear ready, determined, and adventurous with poses and positioning that convey excitement, purpose, and embarking on something epic.`,
    suffix: dedent`
      Rendered in the same style as the reference image: a ${resolveArtStyle(book.artStyle)}.

      Do NOT include any other characters.`
  };

  const image = await generateImageWithSafetyRewrite(
    getProvider('image_generation_chat'),
    {
      prompt,
      refImages: [{ data: compositeBase64, mimeType: 'image/png' }],
      aspectRatio: '16:9'
    }
  );

  const key = `user-worlds/${userWorld.id}`;
  const imageUrl = buildAssetUrl(key, image.mimeType);
  const { relPath } = parseAssetUrl(imageUrl);
  await host.fs.write(relPath, image.data);

  await updateUserWorldById(userWorldId, { imageUrl });

  return imageUrl;
}
