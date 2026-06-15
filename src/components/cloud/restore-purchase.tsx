import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { CLOUD_API } from '@/lib/cloud';

export function RestorePurchase({
  onBack,
  invalidationQueryKeys,
  linkCloudAccount
}: {
  onBack?: () => void;
  invalidationQueryKeys: string[][];
  linkCloudAccount: (externalId: string) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');

  const sendOtpMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${CLOUD_API}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      await parseCloudResponse(res);
    },
    onSuccess: () => setStep('otp')
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${CLOUD_API}/restore/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp })
      });
      const data = await parseCloudResponse<{
        userId: string;
        hasActiveSubscription: boolean;
      }>(res);

      if (!data.result?.hasActiveSubscription) {
        throw new Error('No active subscription found for this email');
      }
      await linkCloudAccount(data.result.userId);
      return data.result;
    },
    onSuccess: () => {
      for (const key of invalidationQueryKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    }
  });

  return (
    <div className="flex flex-1 flex-col items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="font-serif text-xl tracking-tight text-balance">
            Restore previous purchase
          </h2>
          <div className="h-px w-8 bg-border" />
          <p className="text-xs text-muted-foreground">
            {step === 'otp' ? (
              <>
                If we found a matching account, a code was sent to{' '}
                <span className="font-medium text-foreground">{email}</span>.
              </>
            ) : (
              <>
                Enter the email address you used during checkout. We'll send you a
                verification code.
              </>
            )}
          </p>
        </div>

        {step === 'otp' ? (
          <>
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={setOtp}
                onComplete={() => verifyMutation.mutate()}
                validationType="alpha"
                normalizeValue={(value) => value.toUpperCase()}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              className="w-full"
              disabled={otp.length < 6 || verifyMutation.isPending}
              onClick={() => verifyMutation.mutate()}
            >
              {verifyMutation.isPending ? 'Verifying...' : 'Verify'}
            </Button>

            {verifyMutation.isError && (
              <p className="text-xs text-destructive">{verifyMutation.error.message}</p>
            )}

            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => {
                setStep('email');
                setOtp('');
                verifyMutation.reset();
              }}
            >
              Use a different email
            </button>
          </>
        ) : (
          <>
            <Field orientation="vertical">
              <FieldLabel>Email address</FieldLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email) sendOtpMutation.mutate();
                }}
              />
            </Field>

            <Button
              className="w-full"
              disabled={!email || sendOtpMutation.isPending}
              onClick={() => sendOtpMutation.mutate()}
            >
              {sendOtpMutation.isPending ? 'Sending...' : 'Confirm'}
            </Button>

            {sendOtpMutation.isError && (
              <p className="text-xs text-destructive">{sendOtpMutation.error.message}</p>
            )}
          </>
        )}

        {onBack && (
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline underline-offset-2"
            onClick={onBack}
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}

type CloudApiResponse<T = undefined> = {
  success: boolean;
  result?: T;
  errors?: { code: number; message: string }[];
};

async function parseCloudResponse<T>(res: Response): Promise<CloudApiResponse<T>> {
  const data = (await res.json().catch(() => null)) as CloudApiResponse<T> | null;

  if (!res.ok || !data?.success) {
    throw new Error(
      data?.errors?.[0]?.message ??
        (res.status === 429
          ? 'Too many requests. Please wait a minute and try again.'
          : 'Request failed')
    );
  }

  return data;
}
