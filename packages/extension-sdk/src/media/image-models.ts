// shared by backend and frontend, don't import anything too backend-y here!

import { resolveArtStyle } from './art-style';

type CharacterInfo = { name: string; appearance: string };

export type CharacterContext = {
  charactersWithIndividualImages: CharacterInfo[];
  charactersInCompositeImage: CharacterInfo[];
  charactersWithoutImages: CharacterInfo[];
};

const IMAGE_MODELS = {
  'gemini-2.5-flash-image': {
    // technically gemini supports many more reference images,
    // but I've found when the scene is provided as a standalone reference image,
    // Gemini is hesitant to make big changes to the scene.
    // when it's provided composited next to the character reference images, it is forced
    // to make an entirely new scene image instead of applying a small edit.
    maxReferenceImages: 1,
    imageTag: (i: number) => `${i + 1}.`,
    compositeImageTag: 'the reference image'
  },
  // honestly seems worse or on-par w/ gemini-2.5-flash-image and much more expensive...
  'gemini-3.1-flash-image-preview': {
    maxReferenceImages: 1, // at least for initial generation, 1 seems best here
    imageTag: (i: number) => `${i + 1}.`,
    compositeImageTag: 'the reference image'
  },
  'grok-imagine-image': {
    maxReferenceImages: 3,
    imageTag: (i: number) => `<IMAGE_${i}>`
  },
  // gpt-image-2's edits endpoint accepts up to 16 reference images,
  // but to keep cost down we composite everything into one like Gemini.
  'gpt-image-2': {
    maxReferenceImages: 1,
    imageTag: (i: number) => `${i + 1}.`,
    compositeImageTag: 'the reference image'
  }
} as const;

export type ImageModel = keyof typeof IMAGE_MODELS;
type ModelEntry = (typeof IMAGE_MODELS)[ImageModel];

function getImageTag(model: ModelEntry, index: number): string {
  return model.imageTag(index);
}

function getCompositeImageTag(model: ModelEntry, index: number): string {
  if ('compositeImageTag' in model) return model.compositeImageTag;
  return model.imageTag(index);
}

function getSceneImageSuffix(_model: ModelEntry, artStyle: string | null): string {
  // if ('sceneImageSuffix' in model) return model.sceneImageSuffix;
  return ` Render the image in a ${resolveArtStyle(artStyle)}`;
}

// -- Shared prompt rendering --

function renderCharacterBlock(
  model: ModelEntry,
  context: CharacterContext,
  imageIndexStart: number
): { text: string; nextImageIndex: number } {
  const parts: string[] = [];
  let imageIndex = imageIndexStart;

  if (context.charactersWithIndividualImages.length > 0) {
    const characterList = context.charactersWithIndividualImages
      .map((c) => `${getImageTag(model, imageIndex++)} ${c.name}: ${c.appearance}`)
      .join('\n');
    parts.push(
      context.charactersWithIndividualImages.length === 1
        ? `Character in the reference image:\n${characterList}`
        : `Characters in the reference images:\n${characterList}`
    );
  }

  if (context.charactersInCompositeImage.length > 0) {
    const tag = getCompositeImageTag(model, imageIndex++);
    const characterList = context.charactersInCompositeImage
      .map((c) => `${c.name}: ${c.appearance}`)
      .join('\n');
    parts.push(`Characters in ${tag} (left to right):\n${characterList}`);
  }

  if (context.charactersWithoutImages.length > 0) {
    const hasOtherCharacters =
      context.charactersWithIndividualImages.length > 0 ||
      context.charactersInCompositeImage.length > 0;
    const appearanceList = context.charactersWithoutImages
      .map((c) => `${c.name}: ${c.appearance}`)
      .join('\n');
    const header = hasOtherCharacters
      ? `Also in the scene (no reference image available):`
      : `${context.charactersWithoutImages.length === 1 ? 'Character' : 'Characters'} in the scene:`;
    parts.push(`${header}\n${appearanceList}`);
  }

  return { text: parts.join('\n\n'), nextImageIndex: imageIndex };
}

// Structured prompt with:
// - a stable `prefix` (character references / reference image mapping)
// - a mutable `content` (scene description)
// - a `suffix` (rendering/continuity directives)
export type StructuredPrompt = {
  prefix: string;
  content: string;
  suffix: string;
};

export function assemblePrompt(p: StructuredPrompt): string {
  return [p.prefix, p.content, p.suffix].filter(Boolean).join('\n\n');
}

export function renderStartPrompt(
  model: ModelEntry,
  content: string,
  context: CharacterContext,
  artStyle: string | null = null
): StructuredPrompt {
  const { text: charBlock } = renderCharacterBlock(model, context, 0);
  return {
    prefix: charBlock,
    content,
    suffix: `Rendered in a ${resolveArtStyle(artStyle)}`
  };
}

export function renderContinuationPrompt(
  model: ModelEntry,
  content: string,
  context: CharacterContext,
  artStyle: string | null = null
): StructuredPrompt {
  const { text: charBlock, nextImageIndex } = renderCharacterBlock(model, context, 0);
  // When maxReferenceImages is 1, the scene is either the only image (implicit)
  // or baked into the composite — no separate scene image to reference.
  const suffix =
    model.maxReferenceImages > 1
      ? `Use ${getImageTag(model, nextImageIndex)} for continuity of the scene.${getSceneImageSuffix(model, artStyle)}`
      : '';
  return { prefix: charBlock, content, suffix };
}
