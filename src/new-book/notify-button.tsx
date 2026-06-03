import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';

import { Checkbox } from '@/components/ui/checkbox';

async function ensureNotificationPermission(): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === 'granted';
  }
  return granted;
}

export function NotifyButton({
  enabled,
  onChange
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const handleChange = async (checked: boolean) => {
    if (!checked) {
      onChange(false);
      return;
    }
    if (await ensureNotificationPermission()) onChange(true);
  };

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
      <Checkbox
        checked={enabled}
        onCheckedChange={(checked) => void handleChange(checked === true)}
      />
      Notify me when ready
    </label>
  );
}
