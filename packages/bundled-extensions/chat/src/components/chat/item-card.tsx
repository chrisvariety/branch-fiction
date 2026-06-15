import { useRender } from '@base-ui/react/use-render';
import { IconBook } from '@tabler/icons-react';
import clsx from 'clsx';

export function ItemCard({
  title,
  coverImageUrl,
  isContinuing,
  loading = 'lazy',
  render
}: {
  title: string;
  coverImageUrl?: string | null;
  isContinuing?: boolean;
  loading?: 'eager' | 'lazy';
  render: React.ReactElement;
}) {
  return useRender({
    render,
    props: {
      className: clsx(
        'group flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-border text-left shadow-[0_0_15px_rgba(0,0,0,0.1)] transition-colors',
        isContinuing
          ? 'bg-muted shadow-[inset_0_0_5px_rgba(0,0,0,0.1)]'
          : 'bg-background hover:bg-muted/60'
      ),
      children: (
        <>
          {coverImageUrl ? (
            <img
              src={coverImageUrl}
              alt={title}
              loading={loading}
              className="aspect-video w-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-muted">
              <IconBook className="size-8 text-muted-foreground" />
            </div>
          )}
          <div
            className={clsx(
              'flex flex-col gap-3 px-5 py-4',
              !coverImageUrl && 'border-t border-border'
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                {title}
              </span>
              <span
                className={clsx(
                  'flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors',
                  isContinuing
                    ? 'border-2 border-primary bg-background text-primary'
                    : 'border-zinc-950 bg-neutral-800 text-white group-hover:bg-neutral-700'
                )}
              >
                {isContinuing ? 'Continue' : 'Enter'}
              </span>
            </div>
          </div>
        </>
      )
    }
  });
}
