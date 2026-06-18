import type { CharacterScene } from '@/worker/db/models/chapter-scene/get-scenes';

export interface KnowledgeArc {
  title: string | null;
  startChapterIdx: number;
  endChapterIdx: number;
  content: string;
}

export interface BuildKnowledgeInput {
  name: string;
  characterArcs: KnowledgeArc[];
  relationshipArcs: KnowledgeArc[];
  scenes: CharacterScene[];
  // When set, only material up to and including this chapter is included.
  anchorChapterIdx: number | null;
}

// Assembles a Runway knowledge document from raw arcs/scenes — no LLM, so it stays accurate.
export function buildKnowledge(input: BuildKnowledgeInput): string {
  const { name, anchorChapterIdx } = input;
  const withinHorizon = (endIdx: number) =>
    anchorChapterIdx === null || endIdx <= anchorChapterIdx;

  const characterArcs = input.characterArcs.filter((a) => withinHorizon(a.endChapterIdx));
  const relationshipArcs = input.relationshipArcs.filter((a) =>
    withinHorizon(a.endChapterIdx)
  );
  const scenes = input.scenes.filter((s) => withinHorizon(s.chapterIdx));

  const lines: string[] = [`# Who you are: ${name}`];

  if (anchorChapterIdx !== null) {
    lines.push(
      '',
      `This is everything you know so far. You have not yet lived anything beyond this point in your story — do not reference or hint at events you have not yet experienced.`
    );
  }

  if (characterArcs.length > 0) {
    lines.push('', '## Your story so far');
    for (const arc of characterArcs) {
      lines.push('', `### ${arc.title ?? 'Arc'}`, arc.content);
    }
  }

  if (relationshipArcs.length > 0) {
    lines.push('', '## The people in your life');
    for (const arc of relationshipArcs) {
      lines.push('', `### ${arc.title ?? 'A relationship'}`, arc.content);
    }
  }

  if (scenes.length > 0) {
    lines.push('', '## Moments you have lived');
    for (const scene of scenes) {
      const setting = scene.setting ? ` — ${scene.setting}` : '';
      lines.push(`- ${scene.title}${setting}`);
    }
  }

  return lines.join('\n');
}

// FNV-1a — small, dependency-free, used only to detect content changes.
export function hashContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
