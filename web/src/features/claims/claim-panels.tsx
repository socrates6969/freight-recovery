/**
 * Small presentational pieces of the claim sheet (split out to keep ClaimSheet.tsx under the file-size
 * limit): the Summary field row and the History tab (the packet's approval records).
 */
import type { PacketDto } from '@fr/shared';
import type { ReactNode } from 'react';

import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime, STATUS_LABEL } from '../../lib/format';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-1">
      <dt className="muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const NO_ACTIONS_TEXT = 'No review actions yet.';

export function HistoryPanel({ hasPacket, packet }: { hasPacket: boolean; packet: PacketDto | undefined }) {
  if (!hasPacket) return <p className="muted">{NO_ACTIONS_TEXT}</p>;
  if (!packet) return <div className="skeleton h-24" aria-hidden="true" />;
  if (packet.approvals.length === 0) return <p className="muted">{NO_ACTIONS_TEXT}</p>;
  return (
    <ol className="flex flex-col gap-3">
      {packet.approvals.map((a) => (
        <li key={a.id} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-medium">
              {a.action.replace('_', ' ').toLowerCase()} - revision <span className="num">{a.packetRevision}</span>
            </span>
            <span className="muted num">{formatDateTime(a.createdAt)}</span>
          </div>
          <p className="muted text-xs">
            <SafeText value={a.actor.name} /> ({a.actor.role.toLowerCase()}) - {STATUS_LABEL[a.fromStatus] ?? a.fromStatus} to {STATUS_LABEL[a.toStatus] ?? a.toStatus}
          </p>
          <p className="mt-1">
            <SafeText value={a.reason} />
          </p>
        </li>
      ))}
    </ol>
  );
}