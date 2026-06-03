import { useEffect, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

export function useElementSize<T extends HTMLElement = HTMLDivElement>(
  ref: React.RefObject<T | null>
): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    const observer = new ResizeObserver(() => update());
    observer.observe(element);
    const raf = window.requestAnimationFrame(update);

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [ref]);

  return size;
}
