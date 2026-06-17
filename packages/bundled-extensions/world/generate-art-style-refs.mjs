#!/usr/bin/env node
// One-off: FAL_KEY=... node generate-art-style-refs.mjs — writes 512px JPEG src/screens/art-styles/<id>.jpg

import { execFileSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'src/screens/art-styles');

// A consistent scene so the styles are directly comparable.
const SCENE =
  'A lone hooded traveler with a walking staff stands on a rocky cliff path, ' +
  'gazing toward a distant castle on a misty mountain across a vast green valley, ' +
  'dramatic clouds and golden late-afternoon light. Square composition.';

const STYLES = [
  // [
  //   'digital-illustration',
  //   'polished, semi-realistic digital illustration style (not photorealistic)'
  // ],
  // [
  //   'studio-ghibli',
  //   'Studio Ghibli-inspired hand-painted anime style with soft painterly backgrounds, lush nature, gentle linework, and warm nostalgic light'
  // ],
  // [
  //   'photorealistic',
  //   'photorealistic, cinematic style with natural lighting and lifelike detail'
  // ]
  // [
  //   'anime',
  //   'modern anime style with crisp cel-shaded linework, vibrant colors, and expressive characters'
  // ],
  [
    'oil-painting',
    'classical oil painting style with visible brushwork, rich impasto texture, and dramatic chiaroscuro lighting'
  ],
  // [
  //   'watercolor',
  //   'soft watercolor painting style with delicate washes, bleeding pigments, and a light airy feel'
  // ],
  [
    'comic-book',
    'bold comic book and graphic-novel style with heavy ink outlines, dynamic shading, and saturated flat colors'
  ]
  // [
  //   'storybook',
  //   "whimsical children's storybook illustration style with gentle textures, hand-drawn charm, and warm inviting colors"
  // ],
  // [
  //   'stylized-3d',
  //   'stylized 3D animated film style with smooth rounded forms, soft global illumination, and expressive character design'
  // ],
  // [
  //   'dark-fantasy',
  //   'dark painterly fantasy concept-art style with moody atmosphere, dramatic lighting, and richly detailed environments'
  // ]
];

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error('Set FAL_KEY in your environment.');
  process.exit(1);
}

const headers = { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(prompt) {
  const submit = await fetch('https://queue.fal.run/fal-ai/nano-banana-2', {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt })
  });
  if (!submit.ok) throw new Error(`submit ${submit.status}: ${await submit.text()}`);
  const { request_id } = await submit.json();

  const base = `https://queue.fal.run/fal-ai/nano-banana-2/requests/${request_id}`;
  for (;;) {
    await sleep(2000);
    const status = await fetch(`${base}/status`, { headers });
    const { status: s } = await status.json();
    if (s === 'COMPLETED') break;
    if (s === 'FAILED') throw new Error('request FAILED');
  }

  const result = await fetch(base, { headers });
  const { images } = await result.json();
  const url = images?.[0]?.url;
  if (!url) throw new Error('no image url in result');
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

for (const [id, style] of STYLES) {
  const prompt = `${SCENE} Rendered in a ${style}. Do not include any text or labels.`;
  process.stdout.write(`Generating ${id}… `);
  try {
    const buf = await generate(prompt);
    const tmp = join(OUT_DIR, `${id}.png.tmp`);
    await writeFile(tmp, buf);
    execFileSync('sips', [
      '-Z',
      '512',
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      '80',
      tmp,
      '--out',
      join(OUT_DIR, `${id}.jpg`)
    ]);
    await rm(tmp);
    console.log('done');
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
  }
}
