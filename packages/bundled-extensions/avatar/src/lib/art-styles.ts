export interface ArtStyle {
  id: string;
  label: string;
  prompt: string;
}

// Photorealistic leads — it reads best as a talking-head avatar — but any style works.
export const ART_STYLES: ArtStyle[] = [
  {
    id: 'photorealistic',
    label: 'Photorealistic',
    prompt: 'photorealistic, cinematic style with natural lighting and lifelike detail'
  },
  {
    id: 'digital-illustration',
    label: 'Digital Illustration',
    prompt: 'polished, semi-realistic digital illustration style (not photorealistic)'
  },
  {
    id: 'studio-ghibli',
    label: 'Studio Ghibli',
    prompt:
      'Studio Ghibli-inspired hand-painted anime style with soft painterly backgrounds, gentle linework, and warm nostalgic light'
  },
  {
    id: 'anime',
    label: 'Anime',
    prompt:
      'modern anime style with crisp cel-shaded linework, vibrant colors, and expressive characters'
  },
  {
    id: 'oil-painting',
    label: 'Oil Painting',
    prompt:
      'classical oil painting style with visible brushwork, rich impasto texture, and dramatic chiaroscuro lighting'
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    prompt:
      'soft watercolor painting style with delicate washes, bleeding pigments, and a light airy feel'
  },
  {
    id: 'comic-book',
    label: 'Comic Book',
    prompt:
      'bold comic book and graphic-novel style with heavy ink outlines, dynamic shading, and saturated flat colors'
  },
  {
    id: 'storybook',
    label: 'Storybook',
    prompt:
      "whimsical children's storybook illustration style with gentle textures, hand-drawn charm, and warm inviting colors"
  },
  {
    id: 'stylized-3d',
    label: 'Stylized 3D',
    prompt:
      'stylized 3D animated film style with smooth rounded forms, soft global illumination, and expressive character design'
  },
  {
    id: 'dark-fantasy',
    label: 'Dark Fantasy',
    prompt:
      'dark painterly fantasy concept-art style with moody atmosphere, dramatic lighting, and richly detailed environments'
  }
];

const ART_STYLE_IMAGES = import.meta.glob('../screens/art-styles/*.jpg', {
  eager: true,
  import: 'default'
}) as Record<string, string>;

export function artStyleImage(id: string): string | undefined {
  return ART_STYLE_IMAGES[`../screens/art-styles/${id}.jpg`];
}
