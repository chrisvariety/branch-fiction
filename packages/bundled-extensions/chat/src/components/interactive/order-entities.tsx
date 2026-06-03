// Returns ordered carousel items based on current step and selections
// For places, reorders based on character affinity scores

import { CurrentStep } from './step';

type CarouselItem = {
  id: string;
  bookEntityId: string;
  title: string;
  description?: string;
  imageUrl?: string;
};

type InteractiveEntity = {
  id: string;
  bookEntity: {
    id: string;
    name: string;
    identityTag?: string | null;
    imageUrl?: string | null;
  } | null;
};

export function useOrderedCarouselItems({
  currentStep,
  characterEntities,
  placeEntities,
  selectedCharacters,
  characterPlaceScores
}: {
  currentStep: CurrentStep;
  characterEntities: InteractiveEntity[];
  placeEntities: InteractiveEntity[];
  selectedCharacters: {
    id: string;
  }[];
  characterPlaceScores: {
    characterBookEntityId: string;
    placeBookEntityId: string;
    score: number;
  }[];
}): CarouselItem[] {
  if (currentStep === 'selectCharacters') {
    return interactiveEntitiesToCarouselItems(characterEntities);
  }

  // selectPlace - show places ordered by character affinity
  if (selectedCharacters.length === 0) {
    return interactiveEntitiesToCarouselItems(placeEntities);
  }

  const characterEntityToBookEntityId = new Map(
    characterEntities.filter((e) => e.bookEntity).map((e) => [e.id, e.bookEntity!.id])
  );

  const selectedSet = new Set(
    selectedCharacters
      .map((c) => characterEntityToBookEntityId.get(c.id))
      .filter((id): id is string => id != null)
  );

  // Group scores by place
  const scoresByPlace = new Map<
    string,
    { characterIds: Set<string>; totalScore: number }
  >();

  for (const score of characterPlaceScores) {
    if (!selectedSet.has(score.characterBookEntityId)) continue;

    const existing = scoresByPlace.get(score.placeBookEntityId);
    if (existing) {
      existing.characterIds.add(score.characterBookEntityId);
      existing.totalScore += score.score;
    } else {
      scoresByPlace.set(score.placeBookEntityId, {
        characterIds: new Set([score.characterBookEntityId]),
        totalScore: score.score
      });
    }
  }

  // Get place IDs that have scores for ALL selected characters, sorted by total score
  const recommendedPlaceIds = Array.from(scoresByPlace.entries())
    .filter(([, data]) => data.characterIds.size === selectedSet.size)
    .sort((a, b) => b[1].totalScore - a[1].totalScore)
    .slice(0, 2)
    .map(([placeId]) => placeId);

  if (recommendedPlaceIds.length === 0) {
    return interactiveEntitiesToCarouselItems(placeEntities);
  }

  const recommendedSet = new Set(recommendedPlaceIds);
  const recommended = placeEntities.filter(
    (e) => e.bookEntity && recommendedSet.has(e.bookEntity.id)
  );
  const others = placeEntities.filter(
    (e) => !e.bookEntity || !recommendedSet.has(e.bookEntity.id)
  );

  // Sort recommended by their position in recommendedPlaceIds
  recommended.sort(
    (a, b) =>
      recommendedPlaceIds.indexOf(a.bookEntity!.id) -
      recommendedPlaceIds.indexOf(b.bookEntity!.id)
  );

  return interactiveEntitiesToCarouselItems([...recommended, ...others]);
}

function interactiveEntitiesToCarouselItems(
  entities: InteractiveEntity[]
): CarouselItem[] {
  return entities
    .filter((entity) => entity.bookEntity)
    .map((entity) => ({
      id: entity.id,
      bookEntityId: entity.bookEntity!.id,
      title: entity.bookEntity!.name,
      description: entity.bookEntity!.identityTag ?? undefined,
      imageUrl: entity.bookEntity!.imageUrl ?? undefined
    }));
}
