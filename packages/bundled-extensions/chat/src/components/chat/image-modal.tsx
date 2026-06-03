import { IconMaximize, IconX } from '@tabler/icons-react';
import clsx from 'clsx';
import { useEffect, useState } from 'react';

import { Spinner } from '@/components/ui/spinner';

export function ImageModal({
  src,
  thumbnailSrc,
  alt,
  onClose
}: {
  src: string;
  thumbnailSrc?: string;
  alt: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.src = src;
  }, [src]);

  const showThumbnail = thumbnailSrc && !loaded;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        >
          <IconX className="h-5 w-5" />
        </button>
        <div className="relative">
          <img
            src={showThumbnail ? thumbnailSrc : src}
            alt={alt}
            className={clsx(
              'aspect-video max-h-[90vh] max-w-[90vw] rounded-lg object-contain transition-[filter] duration-300',
              showThumbnail ? 'h-192 blur-sm' : 'blur-0'
            )}
          />
          {showThumbnail && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Spinner className="size-8 text-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ClickableImage({
  src,
  largeSrc,
  alt,
  className,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
  largeSrc?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="group relative cursor-pointer" onClick={() => setOpen(true)}>
        <img
          src={src}
          srcSet={largeSrc ? `${src} 512w, ${largeSrc} 1024w` : undefined}
          sizes={largeSrc ? '(min-width: 1024px) 672px, 512px' : undefined}
          alt={alt}
          {...props}
          className={clsx(
            className,
            'transition-transform duration-700 group-hover:scale-105'
          )}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50">
            <IconMaximize className="h-4 w-4 text-white" />
          </div>
        </div>
      </div>
      {open && (
        <ImageModal
          src={largeSrc || src}
          thumbnailSrc={largeSrc ? src : undefined}
          alt={alt}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
