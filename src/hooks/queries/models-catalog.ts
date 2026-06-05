import { modelsCatalogVersion } from '@branch-fiction/extension-sdk/models-catalog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { refreshModelsCatalog } from '@/lib/llm/models-catalog';

export type ModelsCatalogHandle = {
  // bumps when a newer catalog is applied; use as a memo dependency
  version: number;
  onRefresh: () => void;
  isFetching: boolean;
};

export function useModelsCatalog(): ModelsCatalogHandle {
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(() => modelsCatalogVersion());

  const refresh = useMutation({
    mutationFn: refreshModelsCatalog,
    onSettled: () => {
      setVersion(modelsCatalogVersion());
      // model display names can change with the catalog
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
    onError: (e) => {
      console.warn('models catalog refresh failed:', e);
    }
  });

  return {
    version,
    onRefresh: () => refresh.mutate(),
    isFetching: refresh.isPending
  };
}
