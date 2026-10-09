import { useQuery } from '@tanstack/react-query';

import { useApi, useSession } from '../../app-context';

export interface Features {
  ready: boolean;
  worklist: boolean;
  similar: boolean;
  provenance: boolean;
}

/** Tenant feature flags, loaded once per session; any failure hides every intelligence feature (fail closed). */
export function useFeatures(): Features {
  const api = useApi();
  const user = useSession((s) => s.user);
  const permissions = useSession((s) => s.permissions);
  const enabled = Boolean(user?.tenant) && permissions.includes('claims:read');
  const q = useQuery({
    queryKey: ['features', user?.id ?? ''],
    queryFn: () => api.features(),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const flags = q.isSuccess ? q.data.flags : {};
  return {
    ready: q.isSuccess,
    worklist: flags['intelligence.worklist'] === true,
    similar: flags['intelligence.similar_claims'] === true,
    provenance: flags['intelligence.provenance'] === true,
  };
}
