'use client';

import { useSyncExternalStore } from 'react';
import { getPhoneStatus, subPhoneStatus, type PhoneStatus } from './site';

/** The paired phone's status (src/lib/pair/site.ts), or 'none' when the site's wallet is not a phone. */
export function usePhoneLink(isPhone: boolean): PhoneStatus {
  const s = useSyncExternalStore(subPhoneStatus, getPhoneStatus, () => 'none' as PhoneStatus);
  return isPhone ? s : 'none';
}
