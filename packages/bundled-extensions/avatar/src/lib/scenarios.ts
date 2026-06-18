// Conversational modes the avatar can open in: each pairs a persona + opener with a knowledge scope.

export type ScenarioMode = 'in_the_moment' | 'reflective' | 'reunion' | 'relationship';

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
    mode: 'reflective',
    title: 'Looking back',
    blurb:
      'They speak from the far side of the story, willing to turn over their choices and what they cost.',
    sceneAnchored: false
  },
  {
    mode: 'reunion',
    title: 'Reunion',
    blurb:
      'A warm, guarded meeting — they treat you as someone worth their time, and talk plainly.',
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
