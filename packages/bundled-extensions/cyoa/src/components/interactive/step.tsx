export type CurrentStep = 'selectCharacters' | 'selectPlace';

type StepState = {
  currentStep: CurrentStep;
  selectedCharacters: { id: string }[];
  selectedPlace: { id: string } | null;
};

/**
 * Get the previous step based on current state.
 * Returns null if there is no previous step (i.e., at selectCharacters).
 */
export function getPreviousStep(state: StepState): CurrentStep | null {
  const { currentStep } = state;

  switch (currentStep) {
    case 'selectCharacters':
      return null;
    case 'selectPlace':
      return 'selectCharacters';
  }
}

/**
 * Get the next step based on current state.
 * Returns null if there is no valid next step (e.g., missing required selections).
 */
export function getNextStep(state: StepState): CurrentStep | null {
  const { currentStep, selectedCharacters } = state;

  switch (currentStep) {
    case 'selectCharacters':
      // Can only proceed if at least one character is selected
      return selectedCharacters.length > 0 ? 'selectPlace' : null;
    case 'selectPlace':
      // Final step - ENTER_WORLD is triggered via canProceed
      return null;
  }
}

/**
 * Check if the user can proceed (to next step or to enter world).
 */
export function canGoNext(state: StepState): boolean {
  // At selectPlace, can proceed to enter world if place is selected
  if (state.currentStep === 'selectPlace') {
    return state.selectedPlace !== null;
  }
  return getNextStep(state) !== null;
}

/**
 * Check if the user can go back to the previous step.
 */
export function canGoBack(state: StepState): boolean {
  return getPreviousStep(state) !== null;
}

/**
 * Derive the interactive panel ('characters' | 'place') from the current step.
 */
export function getInteractivePanel(currentStep: CurrentStep): 'characters' | 'place' {
  return currentStep === 'selectCharacters' ? 'characters' : 'place';
}
