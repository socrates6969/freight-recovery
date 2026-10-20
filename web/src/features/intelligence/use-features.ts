import { useQuery } from '@tanstack/react-query';

import { useApi, useSession } from '../../app-context';

export interface Features {
  ready: boolean;
  worklist: boolean;
  similar: boolean;
  provenance: boolean;
  /** Step 6: charge suggestions and team labels. */
  charges: boolean;
  /** Step 7: fuel tables and the fuel-surcharge check. */
  fuel: boolean;
  /** Step 7: cost outlook page. */
  outlook: boolean;
  /** Step 8: ocean D&D invoice audit page. */
  oceanDd: boolean;
  /** REQ-20261020-dd-deadline: reviewer-routing shadow section on the insights page (default off). */
  routingShadow: boolean;
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
    charges: flags['intelligence.charge_suggestions'] === true,
    fuel: flags['intelligence.fuel_check'] === true,
    outlook: flags['intelligence.cost_outlook'] === true,
    oceanDd: flags['intelligence.ocean_dd'] === true,
    routingShadow: flags['intelligence.routing_shadow'] === true,
  };
}
