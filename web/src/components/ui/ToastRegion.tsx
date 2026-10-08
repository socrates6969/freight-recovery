import { useStore } from 'zustand';

import { useServices } from '../../app-context';

/** aria-live region for status toasts (text only, auto-dismiss after 5 s). */
export function ToastRegion() {
  const store = useServices().toasts;
  const toasts = useStore(store, (s) => s.toasts);
  return (
    <div role="status" aria-label="Notifications" aria-live="polite" className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="toast safe-text">
          {t.message}
        </div>
      ))}
    </div>
  );
}
