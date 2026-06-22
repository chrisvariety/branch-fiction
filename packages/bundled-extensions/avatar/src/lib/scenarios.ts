// Conversational modes the avatar can open in: each pairs a persona + opener with a knowledge scope.

export type ScenarioMode =
  | 'in_the_moment'
  | 'the_decision'
  | 'the_event'
  | 'relationship';

export interface ScenarioModeInfo {
  mode: ScenarioMode;
  title: string;
  // Shown to the user when picking; also steers the generator.
  blurb: string;
  // Whether this mode anchors to a specific scene (and thus clamps knowledge).
  sceneAnchored: boolean;
}

export const SCENARIO_MODES: ScenarioModeInfo[] = [
  {
    mode: 'in_the_moment',
    title: 'In the moment',
    blurb:
      'Drop into a pivotal scene and talk to them as it unfolds. They only know what they knew then.',
    sceneAnchored: true
  },
  {
    mode: 'the_decision',
    title: 'At a crossroads',
    blurb:
      'They lay out a hard choice they faced and ask you outright what you would do — argue it through with them.',
    sceneAnchored: false
  },
  {
    mode: 'the_event',
    title: 'What really happened',
    blurb:
      'Ask them to walk you through a pivotal moment from the story, the real version, in their own words.',
    sceneAnchored: false
  },
  {
    mode: 'relationship',
    title: 'The people in their life',
    blurb:
      'They open the door to the people who shaped them — allies, rivals, the ones they loved.',
    sceneAnchored: false
  }
];

export function scenarioModeInfo(mode: string): ScenarioModeInfo | undefined {
  return SCENARIO_MODES.find((m) => m.mode === mode);
}

export function isScenarioMode(value: string): value is ScenarioMode {
  return SCENARIO_MODES.some((m) => m.mode === value);
}
