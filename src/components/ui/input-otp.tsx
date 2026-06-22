import { OTPField } from '@base-ui/react/otp-field';
import { IconMinus } from '@tabler/icons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

type InputOTPProps = Omit<
  React.ComponentProps<typeof OTPField.Root>,
  'length' | 'onValueChange' | 'onValueComplete'
> & {
  maxLength: number;
  containerClassName?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
};

function InputOTP({
  className,
  containerClassName,
  maxLength,
  onChange,
  onComplete,
  ...props
}: InputOTPProps) {
  return (
    <OTPField.Root
      data-slot="input-otp"
      length={maxLength}
      onValueChange={onChange ? (value) => onChange(value) : undefined}
      onValueComplete={onComplete ? (value) => onComplete(value) : undefined}
      className={cn(
        'cn-input-otp flex items-center has-disabled:opacity-50',
        containerClassName,
        className
      )}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn(
        'flex items-center rounded-lg has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 dark:has-aria-invalid:ring-destructive/40',
        className
      )}
      {...props}
    />
  );
}

function InputOTPSlot({
  index,
  className,
  ...props
}: Omit<React.ComponentProps<typeof OTPField.Input>, 'children'> & {
  index: number;
}) {
  const ariaLabel =
    props['aria-label'] ?? (index === 0 ? undefined : `Character ${index + 1}`);

  return (
    <OTPField.Input
      data-slot="input-otp-slot"
      aria-label={ariaLabel}
      className={cn(
        'relative size-8 border-y border-r border-input bg-transparent text-center text-sm transition-all outline-none first:rounded-l-lg first:border-l last:rounded-r-lg focus:z-10 focus:border-ring focus:ring-3 focus:ring-ring/50 aria-invalid:border-destructive focus:aria-invalid:border-destructive focus:aria-invalid:ring-destructive/20 dark:bg-input/30 dark:focus:aria-invalid:ring-destructive/40',
        className
      )}
      {...props}
    />
  );
}

function InputOTPSeparator(props: React.ComponentProps<typeof OTPField.Separator>) {
  return (
    <OTPField.Separator
      data-slot="input-otp-separator"
      className="flex items-center [&_svg:not([class*='size-'])]:size-4"
      {...props}
    >
      <IconMinus />
    </OTPField.Separator>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
