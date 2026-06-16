import { useCallback, useMemo, useReducer } from 'react';

import {
  canGoNext,
  canGoBack,
  createInitialState,
  createInteractiveReducer,
  getPrimaryCta,
  getTransitionEffects,
  type Character,
  type EffectIntent,
  type InteractiveAction,
  type Place,
  type PrimaryCta
} from './state-machine';

export type { EffectIntent, PrimaryCta };

export function useInteractiveState({
  initialCarouselItemId
}: {
  initialCarouselItemId: string;
}) {
  const reducer = useMemo(() => createInteractiveReducer(), []);

  const [state, baseDispatch] = useReducer(
    reducer,
    initialCarouselItemId,
    createInitialState
  );

  // Derived values
  const canProceed = canGoNext(state);
  const canBack = canGoBack(state);

  const primaryCta = getPrimaryCta(state);

  // Dispatch that returns effect intents for the caller to execute
  const dispatchWithEffects = useCallback(
    (action: InteractiveAction): EffectIntent[] => {
      const prevState = state;
      baseDispatch(action);
      // Note: we compute effects based on what the next state WILL be
      // by running the reducer ourselves
      const nextState = reducer(prevState, action);
      return getTransitionEffects(prevState, nextState, action);
    },
    [state, reducer]
  );

  // === Action helpers ===

  const toggleCharacterSelection = useCallback(
    (character: Character): EffectIntent[] => {
      const isSelected = state.selectedCharacters.some((c) => c.id === character.id);

      if (isSelected) {
        return dispatchWithEffects({
          type: 'DESELECT_CHARACTER',
          characterId: character.id
        });
      } else {
        return dispatchWithEffects({ type: 'SELECT_CHARACTER', character });
      }
    },
    [state.selectedCharacters, dispatchWithEffects]
  );

  const togglePlaceSelection = useCallback(
    (place: Place): EffectIntent[] => {
      const isSelected = state.selectedPlace?.id === place.id;

      if (isSelected) {
        return dispatchWithEffects({ type: 'DESELECT_PLACE' });
      } else {
        return dispatchWithEffects({ type: 'SELECT_PLACE', place });
      }
    },
    [state.selectedPlace?.id, dispatchWithEffects]
  );

  return {
    state,
    dispatch: dispatchWithEffects,
    canGoNext: canProceed,
    canGoBack: canBack,
    primaryCta,
    toggleCharacterSelection,
    togglePlaceSelection
  };
}
