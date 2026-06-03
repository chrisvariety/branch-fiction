import {
  canGoNext as canGoNextPure,
  canGoBack as canGoBackPure,
  getNextStep,
  getPreviousStep,
  type CurrentStep
} from './step';

// === Types ===

export type Character = {
  id: string;
  name: string;
  imageUrl?: string;
};

export type Place = {
  id: string;
  name: string;
  imageUrl?: string;
  identityTag?: string | null;
};

export type PendingPlayerChange = {
  removedCharacter: Character;
  newPlayer: Character;
};

export type CoachmarkType = 'carousel' | 'header-next' | 'cta-characters' | 'cta-place';

export type InteractiveState = {
  currentStep: CurrentStep;
  selectedCharacters: Character[];
  selectedPlace: Place | null;
  playerCharacterId: string | null;
  pendingPlayerChange: PendingPlayerChange | null;
  showPlayingAsToast: boolean;
  showMaxSelectionError: boolean;
  showWelcome: boolean;
  activeCoachmark: CoachmarkType | null;
  activeCarouselItemId: string;
  suggestedCharacterId: string | null;
};

export type InteractiveAction =
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'GO_TO_STEP'; step: CurrentStep }
  | { type: 'SELECT_CHARACTER'; character: Character }
  | { type: 'DESELECT_CHARACTER'; characterId: string }
  | { type: 'CONFIRM_PLAYER_CHANGE' }
  | { type: 'CANCEL_PLAYER_CHANGE' }
  | { type: 'DISMISS_PLAYING_AS_TOAST'; nextCharacterId?: string }
  | { type: 'SELECT_PLACE'; place: Place }
  | { type: 'DESELECT_PLACE' }
  | { type: 'DISMISS_WELCOME' }
  | { type: 'SHOW_MAX_SELECTION_ERROR' }
  | { type: 'DISMISS_MAX_SELECTION_ERROR' }
  | { type: 'SET_ACTIVE_CAROUSEL_ITEM'; itemId: string; source: 'carousel' | 'polygon' }
  | { type: 'RESET_CAROUSEL_TO_FIRST'; firstItemId: string }
  | { type: 'CLICK_ZOOMED_OVERLAY' };

export type EffectIntent =
  | { type: 'RESET_ZOOM' }
  | { type: 'ZOOM_TO_PLACE'; placeId: string }
  | { type: 'ENTER_WORLD' }
  | { type: 'FOCUS_BOTTOM_BAR' };

export const MAX_CHARACTER_SELECTIONS = 4;

// === Reducer Factory ===

function getStepState(state: InteractiveState): Parameters<typeof getNextStep>[0] {
  return {
    currentStep: state.currentStep,
    selectedCharacters: state.selectedCharacters,
    selectedPlace: state.selectedPlace
  };
}

export function createInteractiveReducer() {
  return function interactiveReducer(
    state: InteractiveState,
    action: InteractiveAction
  ): InteractiveState {
    const stepState = getStepState(state);
    // console.log('action', action);

    switch (action.type) {
      case 'GO_NEXT': {
        const nextStep = getNextStep(stepState);
        if (!nextStep) return state;
        // When going forward to selectPlace with a place already selected, set carousel to that place
        if (
          state.currentStep === 'selectCharacters' &&
          nextStep === 'selectPlace' &&
          state.selectedPlace
        ) {
          return {
            ...state,
            currentStep: nextStep,
            activeCarouselItemId: state.selectedPlace.id,
            showPlayingAsToast: false,
            activeCoachmark: 'cta-place'
          };
        }

        return {
          ...state,
          currentStep: nextStep,
          showPlayingAsToast:
            nextStep === 'selectPlace' ? false : state.showPlayingAsToast,
          activeCoachmark: nextStep === 'selectPlace' ? 'carousel' : null
        };
      }

      case 'GO_BACK': {
        const prevStep = getPreviousStep(stepState);
        if (!prevStep) {
          return state;
        }
        return {
          ...state,
          currentStep: prevStep,
          activeCoachmark:
            prevStep === 'selectCharacters' && state.selectedCharacters.length > 0
              ? 'cta-characters'
              : null
        };
      }

      case 'GO_TO_STEP': {
        let activeCoachmark: CoachmarkType | null = null;
        if (action.step === 'selectCharacters' && state.selectedCharacters.length > 0) {
          activeCoachmark = 'cta-characters';
        } else if (action.step === 'selectPlace' && state.selectedPlace) {
          activeCoachmark = 'cta-place';
        }
        return {
          ...state,
          currentStep: action.step,
          showPlayingAsToast:
            action.step === 'selectPlace' ? false : state.showPlayingAsToast,
          activeCoachmark
        };
      }

      case 'SELECT_CHARACTER': {
        const isAlreadySelected = state.selectedCharacters.some(
          (c) => c.id === action.character.id
        );
        if (isAlreadySelected) return state;

        // Max selections check
        if (state.selectedCharacters.length >= MAX_CHARACTER_SELECTIONS) {
          return { ...state, showMaxSelectionError: true };
        }

        // First character - select immediately and show playing-as toast
        if (state.selectedCharacters.length === 0) {
          return {
            ...state,
            selectedCharacters: [action.character],
            playerCharacterId: action.character.id,
            showPlayingAsToast: true,
            suggestedCharacterId: null,
            activeCoachmark: null
          };
        }

        // Add to selections
        return {
          ...state,
          selectedCharacters: [...state.selectedCharacters, action.character],
          suggestedCharacterId: null,
          activeCoachmark: 'cta-characters'
        };
      }

      case 'DESELECT_CHARACTER': {
        const remaining = state.selectedCharacters.filter(
          (c) => c.id !== action.characterId
        );
        const removedCharacter = state.selectedCharacters.find(
          (c) => c.id === action.characterId
        );

        // Show confirmation when: or deselecting down to 1 & character that isn't the original player
        const needsConfirm =
          remaining.length === 1 &&
          state.playerCharacterId &&
          remaining[0].id !== state.playerCharacterId;

        if (needsConfirm && removedCharacter) {
          const newPlayer =
            remaining.find((c) => c.id === state.playerCharacterId) ?? remaining[0];
          return {
            ...state,
            pendingPlayerChange: {
              removedCharacter,
              newPlayer
            },
            showPlayingAsToast: false
          };
        }

        return {
          ...state,
          selectedCharacters: remaining,
          showPlayingAsToast: false,
          suggestedCharacterId: null,
          activeCoachmark: remaining.length > 0 ? 'cta-characters' : null
        };
      }

      case 'CONFIRM_PLAYER_CHANGE': {
        if (!state.pendingPlayerChange) return state;
        return {
          ...state,
          selectedCharacters: state.selectedCharacters.filter(
            (c) => c.id !== state.pendingPlayerChange!.removedCharacter.id
          ),
          playerCharacterId: state.pendingPlayerChange.newPlayer.id,
          pendingPlayerChange: null
        };
      }

      case 'CANCEL_PLAYER_CHANGE': {
        if (!state.pendingPlayerChange) return state;
        return {
          ...state,
          pendingPlayerChange: null
        };
      }

      case 'DISMISS_PLAYING_AS_TOAST': {
        return {
          ...state,
          showPlayingAsToast: false,
          activeCoachmark: 'cta-characters',
          ...(action.nextCharacterId && {
            activeCarouselItemId: action.nextCharacterId,
            suggestedCharacterId: action.nextCharacterId
          })
        };
      }

      case 'SELECT_PLACE': {
        return { ...state, selectedPlace: action.place, activeCoachmark: 'cta-place' };
      }

      case 'DESELECT_PLACE': {
        return { ...state, selectedPlace: null, activeCoachmark: null };
      }

      case 'DISMISS_WELCOME': {
        return {
          ...state,
          showWelcome: false,
          activeCoachmark: 'carousel'
        };
      }

      case 'SHOW_MAX_SELECTION_ERROR': {
        return { ...state, showMaxSelectionError: true };
      }

      case 'DISMISS_MAX_SELECTION_ERROR': {
        return { ...state, showMaxSelectionError: false };
      }

      case 'SET_ACTIVE_CAROUSEL_ITEM': {
        return {
          ...state,
          activeCarouselItemId: action.itemId,
          showPlayingAsToast: false,
          suggestedCharacterId: null,
          activeCoachmark:
            state.activeCoachmark === 'carousel' ? null : state.activeCoachmark
        };
      }

      case 'RESET_CAROUSEL_TO_FIRST': {
        return { ...state, activeCarouselItemId: action.firstItemId };
      }

      case 'CLICK_ZOOMED_OVERLAY': {
        return state;
      }

      default:
        return state;
    }
  };
}

// === Effect Derivation ===

export function getTransitionEffects(
  prevState: InteractiveState,
  nextState: InteractiveState,
  action: InteractiveAction
): EffectIntent[] {
  const effects: EffectIntent[] = [];

  // Clicking Next at selectPlace with a place selected triggers ENTER_WORLD
  if (
    action.type === 'GO_NEXT' &&
    prevState.currentStep === 'selectPlace' &&
    prevState.selectedPlace
  ) {
    effects.push({ type: 'ENTER_WORLD' });
    effects.push({ type: 'ZOOM_TO_PLACE', placeId: prevState.selectedPlace.id });
    return effects;
  }

  // Step transition effects
  if (prevState.currentStep !== nextState.currentStep) {
    const nextStep = nextState.currentStep;
    const prevStep = prevState.currentStep;

    // Going forward to place step: animate zoom out
    if (prevStep === 'selectCharacters' && nextStep === 'selectPlace') {
      effects.push({ type: 'RESET_ZOOM' });
    }
    // Going back to character step: reset zoom
    if (prevStep === 'selectPlace' && nextStep === 'selectCharacters') {
      effects.push({ type: 'RESET_ZOOM' });
    }
  }

  // Zoom to place when selected
  if (
    action.type === 'SELECT_PLACE' &&
    nextState.selectedPlace &&
    !prevState.selectedPlace
  ) {
    effects.push({ type: 'ZOOM_TO_PLACE', placeId: nextState.selectedPlace.id });
  }

  // User clicked the zoomed overlay background
  if (action.type === 'CLICK_ZOOMED_OVERLAY') {
    effects.push({ type: 'RESET_ZOOM' });
  }

  // Dismissing the playing-as toast resets zoom so the suggested character is visible
  if (action.type === 'DISMISS_PLAYING_AS_TOAST') {
    effects.push({ type: 'RESET_ZOOM' });
  }

  if (action.type === 'DISMISS_WELCOME') {
    effects.push({ type: 'FOCUS_BOTTOM_BAR' });
  }

  // Explicit GO_TO_STEP always resets zoom (e.g. returning from configure modal)
  if (action.type === 'GO_TO_STEP') {
    effects.push({ type: 'RESET_ZOOM' });
  }

  // Carousel item change from carousel navigation resets zoom
  if (action.type === 'SET_ACTIVE_CAROUSEL_ITEM' && action.source === 'carousel') {
    effects.push({ type: 'RESET_ZOOM' });
  }

  return effects;
}

// === Primary CTA ===

export type PrimaryCta = {
  action: InteractiveAction;
  intent: 'proceed-to-place' | 'enter-world' | 'select-characters';
};

export function getPrimaryCta(state: InteractiveState): PrimaryCta {
  const { selectedCharacters, selectedPlace } = state;

  if (selectedCharacters.length === 0) {
    return {
      action: { type: 'GO_TO_STEP', step: 'selectCharacters' },
      intent: 'select-characters'
    };
  }

  if (!selectedPlace) {
    return {
      action: { type: 'GO_TO_STEP', step: 'selectPlace' },
      intent: 'proceed-to-place'
    };
  }

  return {
    action: { type: 'GO_NEXT' },
    intent: 'enter-world'
  };
}

// === Helper exports ===

export function canGoNext(state: InteractiveState): boolean {
  return canGoNextPure(getStepState(state));
}

export function canGoBack(state: InteractiveState): boolean {
  return canGoBackPure(getStepState(state));
}

export function createInitialState(initialCarouselItemId: string): InteractiveState {
  return {
    currentStep: 'selectCharacters',
    selectedCharacters: [],
    selectedPlace: null,
    playerCharacterId: null,
    pendingPlayerChange: null,
    showPlayingAsToast: false,
    showMaxSelectionError: false,
    showWelcome: true,
    activeCoachmark: null,
    activeCarouselItemId: initialCarouselItemId,
    suggestedCharacterId: null
  };
}
