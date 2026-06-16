import clsx from 'clsx';

import { transformImageUrl } from '@/lib/media/transform-url';

export function ImageLoader({
  label = 'Generating Image',
  previousImageUrl,
  className
}: {
  label?: string;
  previousImageUrl?: string | null;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'relative flex aspect-video w-full items-center justify-center overflow-hidden',
        className
      )}
    >
      {previousImageUrl && (
        <img
          src={transformImageUrl(previousImageUrl)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover blur-xl"
        />
      )}
      <div
        className="siri-orb absolute inset-0"
        style={
          {
            '--c1': 'oklch(72% 0.06 40)',
            '--c2': 'oklch(78% 0.04 55)',
            '--c3': 'oklch(68% 0.07 340)',
            '--animation-duration': '20s',
            '--blur-amount': '20px',
            '--contrast-amount': '1.8'
          } as React.CSSProperties
        }
      />
      <span className="relative z-1 font-sans text-sm font-medium text-white/60 select-none">
        {label}
      </span>
    </div>
  );
}
