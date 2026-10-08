import { useId, useRef, type ReactNode } from 'react';

import { useFocusTrap } from './use-focus-trap';

/** Accessible modal dialog: role=dialog, aria-modal, labelled by its title, focus trap, Esc closes. */
export function Dialog({
  title,
  onClose,
  children,
  describedBy,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  describedBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, true, onClose);
  return (
    <>
      <div className="overlay" aria-hidden="true" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} className="dialog">
        <h2 id={titleId} className="mb-3 text-base font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </>
  );
}
