import {
  IconChevronLeft,
  IconChevronRight,
  IconPencil,
  type Icon as TablerIcon
} from '@tabler/icons-react';
import clsx from 'clsx';
import { motion } from 'motion/react';

import type { CurrentStep } from './step';

export function InteractiveHeader({
  hidden,
  title,
  currentStep,
  onPrevious,
  onNext,
  onEdit
}: {
  hidden?: boolean;
  title?: string;
  currentStep: CurrentStep;
  onPrevious?: () => void;
  onNext?: () => void;
  onEdit?: () => void;
}) {
  const canGoBack = !!onPrevious;
  const canGoNext = !!onNext;

  return (
    <div
      hidden={hidden}
      className="absolute inset-x-0 top-0 z-20 bg-linear-to-b from-black/80 to-transparent px-4 pt-3 pb-6 lg:rounded-t-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Progress bars */}
      <div className="flex gap-1.5">
        {(['selectCharacters', 'selectPlace'] as const).map((step) => (
          <div key={step} className="relative h-0.5 flex-1 rounded-full bg-white/30">
            {currentStep === step && (
              <motion.div
                layoutId="progress-indicator"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: 'tween', duration: 0.3, ease: 'easeInOut' }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Navigation row */}
      <div className="mt-3 flex items-center">
        <div className="flex w-10 justify-start">
          {onPrevious ? (
            <NavButton
              onClick={onPrevious}
              disabled={!canGoBack}
              icon={IconChevronLeft}
              iconClassName="h-5 w-5"
              aria-label="Back"
            />
          ) : null}
        </div>
        <div className="flex flex-1 items-center justify-center gap-1.5">
          {title && <span className="text-sm font-medium text-white">{title}</span>}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="text-white/70 transition-colors hover:text-white"
              aria-label="Edit"
            >
              <IconPencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex w-10 justify-end">
          <NavButton
            onClick={onNext}
            disabled={!canGoNext}
            icon={IconChevronRight}
            iconClassName="h-5 w-5"
            aria-label="Next"
          />
        </div>
      </div>
    </div>
  );
}

function NavButton({
  onClick,
  disabled,
  icon,
  iconClassName,
  'aria-label': ariaLabel
}: {
  onClick?: () => void;
  disabled: boolean;
  icon: TablerIcon;
  iconClassName?: string;
  'aria-label': string;
}) {
  const IconComponent = icon;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
        disabled
          ? 'bg-background/40 text-primary/50'
          : 'bg-background/90 text-primary hover:bg-background'
      )}
      aria-label={ariaLabel}
    >
      <IconComponent className={iconClassName} />
    </button>
  );
}
