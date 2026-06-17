import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import dedent from 'dedent';
import slug from 'slug';
import { v7 as uuidv7 } from 'uuid';

import { ensureDbReady, getDb } from '@/worker/db';
import { getBookInteractiveEntitiesWithEntitiesByIds } from '@/worker/db/models/book-interactive-entity/get-book-interactive-entity';
import { getBookSettings } from '@/worker/db/models/book-settings/get-book-settings';
import { getBookById } from '@/worker/db/models/book/get-book';
import { createUserWorld } from '@/worker/db/models/user-world/create-user-world';
import {
  findExistingWorldDataByExactEntityIds,
  getUserWorldByUserIdAndSlug
} from '@/worker/db/models/user-world/get-user-world';
import { updateUserWorldById } from '@/worker/db/models/user-world/update-user-world';

import { DEFAULT_USER_ID } from '../../lib/auth';
import { getPiModel } from '../../worker/providers';

const MAX_SCENARIOS_BEFORE_REUSE = 50;

export type BuildWorldParams = {
  bookId: string;
  bookInteractiveEntities: string[];
};

export type BuildWorldResult = {
  worldSlug: string;
  userWorldId: string;
  reused: boolean;
};

export async function buildWorld({
  bookId,
  bookInteractiveEntities: bookInteractiveEntityIds
}: BuildWorldParams): Promise<BuildWorldResult> {
  await ensureDbReady();
  const book = await getBookById(bookId);
  if (!book) throw new Error('Book not found');
  const settings = await getBookSettings(bookId);
  if (!settings) throw new Error('Book settings not found');
  const bookInteractiveEntities = await getBookInteractiveEntitiesWithEntitiesByIds(
    bookInteractiveEntityIds
  );
  const validBookInteractiveEntities = bookInteractiveEntities.filter(
    (entity) => entity.bookId === book.id
  );
  if (validBookInteractiveEntities.length === 0)
    throw new Error('No valid book interactive entities');
  const placeEntity = validBookInteractiveEntities.find(
    (e) => e.bookEntityType === 'PLACE'
  );
  if (!placeEntity) throw new Error('At least one place entity is required');
  const characterEntities = validBookInteractiveEntities.filter(
    (e) => e.bookEntityType === 'CHARACTER'
  );
  if (characterEntities.length === 0)
    throw new Error('At least one character entity is required');

  const title = await generateTitle(
    validBookInteractiveEntities.map((bie) => ({
      name: bie.bookEntityName,
      type: bie.bookEntityType,
      description: bie.bookEntityDescription
    }))
  );
  const titleSlug = slug(title);

  const result = await getDb()
    .transaction()
    .execute(async (trx) => {
      const existing = await getUserWorldByUserIdAndSlug(DEFAULT_USER_ID, titleSlug, trx);
      const finalSlug = existing
        ? `${titleSlug}-${Math.random().toString(36).substring(2, 8)}`
        : titleSlug;

      const userWorldId = uuidv7();
      await createUserWorld(
        {
          id: userWorldId,
          bookIds: Array.from(new Set(validBookInteractiveEntities.map((e) => e.bookId))),
          title,
          slug: finalSlug,
          userId: DEFAULT_USER_ID,
          bookInteractiveEntityIds: validBookInteractiveEntities.map((e) => e.id),
          artStyle: settings.artStyle,
          characterInteractiveType: settings.characterInteractiveType ?? undefined,
          placeInteractiveType: settings.placeInteractiveType ?? undefined,
          accessType: 'preview'
        },
        trx
      );

      return { userWorld: { id: userWorldId }, slug: finalSlug };
    });
  if (!result?.userWorld) throw new Error('Failed to create world');

  // Check if we can reuse existing scenarios + image instead of generating new ones
  const existingWorldData = await findExistingWorldDataByExactEntityIds(
    validBookInteractiveEntities.map((e) => e.id)
  );

  const maxScenarios = MAX_SCENARIOS_BEFORE_REUSE;

  if (
    existingWorldData &&
    existingWorldData.imageUrls.length > 0 &&
    existingWorldData.scenarioIds.length > maxScenarios
  ) {
    // Fisher-Yates shuffle (partial — only need 4)
    const scenarioPool = [...existingWorldData.scenarioIds];
    for (let i = scenarioPool.length - 1; i > 0 && i >= scenarioPool.length - 4; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [scenarioPool[i], scenarioPool[j]] = [scenarioPool[j], scenarioPool[i]];
    }
    const selectedScenarioIds = scenarioPool.slice(-4);

    const randomImageUrl =
      existingWorldData.imageUrls[
        Math.floor(Math.random() * existingWorldData.imageUrls.length)
      ];

    await updateUserWorldById(result.userWorld.id, {
      imageUrl: randomImageUrl,
      scenarioIds: selectedScenarioIds
    });

    return {
      worldSlug: result.slug,
      userWorldId: result.userWorld.id,
      reused: true
    };
  }

  return {
    worldSlug: result.slug,
    userWorldId: result.userWorld.id,
    reused: false
  };
}

async function generateTitle(
  bookEntities: { name: string; type: string; description?: string | null }[]
): Promise<string> {
  const { model, apiKey, reasoning } = getPiModel('text_chat');
  const message = await completeOrThrow(
    model,
    {
      messages: [
        {
          role: 'user',
          content: dedent`Create a short, clever title for a chat between the following character(s) in the following place(s). Mention the character name(s) and place(s), and join them together in a clever way. For example: "Tilly and Bob at the park" or "Alice and gang hit the bar". Return only the title.

          ${bookEntities
            .map(
              ({ name, type, description }) => dedent`Name: ${name}
            Type: ${type}
            ${description ? `Description: ${description}` : ''}`
            )
            .join('\n\n')}`,
          timestamp: Date.now()
        }
      ]
    },
    { apiKey, reasoning, sessionId: uuidv7() }
  );

  const title = getAssistantText(message);
  if (!title) throw new Error('Failed to generate title');
  return title.trim();
}
