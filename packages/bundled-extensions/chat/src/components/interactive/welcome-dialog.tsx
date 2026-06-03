import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useElementSize } from '@/hooks/use-element-size';

function WelcomeDialog({
  title,
  imageLoaded,
  onBegin,
  containerRef
}: {
  title: string;
  imageLoaded: boolean;
  onBegin: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const { width: containerWidth } = useElementSize(containerRef);

  const [waitingForImage, setWaitingForImage] = useState(false);

  useEffect(() => {
    if (waitingForImage && imageLoaded) {
      onBegin();
    }
  }, [waitingForImage, imageLoaded, onBegin]);

  const isWaiting = waitingForImage && !imageLoaded;
  const handleBegin = () => {
    if (imageLoaded) {
      onBegin();
    } else {
      setWaitingForImage(true);
    }
  };

  if (containerWidth <= 0) return null;

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-x-0 top-0 bottom-0 z-40 bg-black/50 backdrop-blur-lg" />
        <Dialog.Popup
          data-gesture-ignore="true"
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-x-0 top-0 bottom-0 z-50"
          aria-labelledby={titleId}
        >
          <div className="flex h-full items-center justify-center px-4 py-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="mt-0 flex h-[calc(100%-3rem)] w-full flex-col rounded-lg bg-white/20 px-6 py-8 text-left md:px-10 md:py-10"
              style={{ maxWidth: containerWidth }}
            >
              <div>
                <p className="text-xs tracking-[0.32em] text-slate-200 uppercase">
                  Enter the world of
                </p>
                <h2
                  id={titleId}
                  className="mt-4 text-3xl tracking-tight text-slate-50 md:text-4xl"
                >
                  {title}
                </h2>

                <div className="mt-6">
                  <p className="text-sm font-semibold tracking-[0.32em] text-slate-50">
                    HOW TO PLAY:
                  </p>
                  <ol className="mt-3 ml-1 list-decimal space-y-2 pl-5 text-slate-200">
                    <li>Select your character(s)</li>
                    <li>Select your location</li>
                    <li>Set the scene</li>
                  </ol>
                </div>
              </div>

              <div className="mt-auto pt-6">
                <div className="mb-3 rounded-lg bg-amber-300/15 px-3 py-2 text-xs text-amber-100">
                  <span className="font-semibold tracking-[0.3em] text-amber-200 uppercase">
                    Spoiler Warning!
                  </span>
                  <p className="mt-1 text-sm text-amber-100">
                    For fans who’ve read the book: spoilers are part of the journey.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="2xl"
                  className="w-full"
                  disabled={isWaiting}
                  onClick={() => handleBegin()}
                >
                  {isWaiting ? (
                    <>
                      <Spinner /> Loading your journey
                    </>
                  ) : (
                    'Begin your journey'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { WelcomeDialog };
