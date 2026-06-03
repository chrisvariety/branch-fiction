import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent
} from 'react';
import { RichTextarea, type CaretPosition, type RichTextareaHandle } from 'rich-textarea';

import { cn } from '@/lib/utils';

import { useGhostSuggestion } from './use-ghost-suggestion';

export interface AutocompleteTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  suggestions: string[];
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
}

export type AutocompleteTextareaRef = {
  focus: () => void;
};

export const AutocompleteTextarea = forwardRef<
  AutocompleteTextareaRef,
  AutocompleteTextareaProps
>(function AutocompleteTextarea(
  {
    value,
    onChange,
    onKeyDown,
    placeholder,
    autoFocus,
    className,
    suggestions,
    disabled,
    minRows = 1,
    maxRows = 10
  },
  forwardedRef
) {
  const ref = useRef<RichTextareaHandle>(null);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => ref.current?.focus()
  }));
  const [cursorAtEnd, setCursorAtEnd] = useState(true);
  const [ghostDismissed, setGhostDismissed] = useState(false);

  const ghost = useGhostSuggestion(value, cursorAtEnd && !ghostDismissed, suggestions);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setGhostDismissed(false);
      onChange(e.target.value);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab' && ghost) {
        e.preventDefault();
        const newValue = value + ghost;
        onChange(newValue);
        requestAnimationFrame(() => {
          ref.current?.setSelectionRange(newValue.length, newValue.length);
        });
        return;
      }

      if (e.key === 'Escape' && ghost) {
        e.preventDefault();
        setGhostDismissed(true);
        return;
      }

      onKeyDown?.(e);
    },
    [ghost, value, onChange, onKeyDown]
  );

  const handleSelectionChange = useCallback(
    (pos: CaretPosition) => {
      setCursorAtEnd(
        pos.selectionStart === value.length && pos.selectionStart === pos.selectionEnd
      );
    },
    [value.length]
  );

  const lineHeight = 1.5;

  return (
    <>
      <RichTextarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelectionChange={handleSelectionChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoHeight
        rows={minRows}
        style={{
          width: '100%',
          maxHeight: `${maxRows * lineHeight}em`,
          overflowY: 'auto'
        }}
        className={cn(
          'w-full resize-none bg-transparent text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none',
          className
        )}
      >
        {(v) => (
          <>
            {v}
            {ghost && <span className="pointer-events-none text-gray-400">{ghost}</span>}
          </>
        )}
      </RichTextarea>
      <div aria-live="polite" className="sr-only">
        {ghost ? `Suggestion: ${ghost.trim()}. Press Tab to accept.` : ''}
      </div>
    </>
  );
});
