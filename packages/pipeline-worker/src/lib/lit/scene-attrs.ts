export function buildSceneAttrs(scene: {
  pov: string;
  povEntity: string;
  location?: string | null;
  setting?: string | null;
}): string {
  const attrs = [
    `point_of_view="${scene.pov}, ${scene.povEntity.replace(/"/g, '&quot;')}"`,
    scene.setting ? `setting="${scene.setting.replace(/"/g, '&quot;')}"` : null,
    scene.location ? `location="${scene.location.replace(/"/g, '&quot;')}"` : null
  ]
    .filter(Boolean)
    .join(' ');

  return attrs;
}
