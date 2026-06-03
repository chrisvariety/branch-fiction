import { getColorSync } from 'colorthief';
import { useEffect, useState } from 'react';

export function useDominantColor(imageUrl: string | null | undefined): string | null {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setColor(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (cancelled) return;
      try {
        // Crop a thin strip from the left edge (10% width) to match the spine/border color
        const canvas = document.createElement('canvas');
        const stripWidth = Math.max(1, Math.round(img.naturalWidth * 0.1));
        canvas.width = stripWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(
          img,
          0,
          0,
          stripWidth,
          img.naturalHeight,
          0,
          0,
          stripWidth,
          img.naturalHeight
        );

        const c = getColorSync(canvas);
        if (c) {
          setColor(c.toString());
        }
      } catch (e) {
        console.error('ColorThief failed:', e);
      }
    };

    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return color;
}
