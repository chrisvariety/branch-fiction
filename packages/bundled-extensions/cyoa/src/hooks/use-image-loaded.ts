import { useEffect, useState } from 'react';

export function useImageLoaded(src: string | null): boolean {
  const [loaded, setLoaded] = useState(false);
  const [prevSrc, setPrevSrc] = useState(src);

  if (src !== prevSrc) {
    setPrevSrc(src);
    setLoaded(false);
  }

  useEffect(() => {
    if (!src) return;

    const img = new Image();
    img.onload = () => setLoaded(true);
    img.src = src;

    return () => {
      img.onload = null;
    };
  }, [src]);

  return src ? loaded : false;
}
