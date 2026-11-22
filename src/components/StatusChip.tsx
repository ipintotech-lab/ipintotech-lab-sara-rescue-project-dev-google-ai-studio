import React from 'react';
import type { SeverityKey } from '../types/sara';
import { SEV } from '../sim/engine';

export type ChipTone = 'neutral' | 'ok' | 'ld' | 'warn' | 'crit' | 'mg' | 'sim' | 'phase2';

const TONE_CLS: Record<ChipTone, string> = {
  neutral: 'bg-[#232a2f] text-[#929ba2] border-[#2c3338]',
  ok: 'bg-[#10303a] text-[#9be5fa] border-[#1f5566]',
  ld: 'bg-[#1f2930] text-[#bdeeff] border-[#2d4a57]',
  warn: 'bg-[#312915] text-[#f6dc7a] border-[#594b21]',
  crit: 'bg-[#361614] text-[#ff9a8a] border-[#612723]',
  mg: 'bg-[#321226] text-[#ff9ad1] border-[#622249]',
  sim: 'bg-[#1b2024] text-[#929ba2] border-[#2c3338]',
  phase2: 'bg-[#2a1222] text-[#ffc4e3] border-[#5a2347]',
};

export function StatusChip({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-[5px] border text-[11.5px] font-medium whitespace-nowrap shrink-0 leading-tight ${TONE_CLS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function SeverityChip({ sev }: { sev: SeverityKey }) {
  const tone: ChipTone =
    sev === 'c' ? 'crit' : sev === 'p' ? 'warn' : sev === 'd' ? 'warn' : 'ok';
  return <StatusChip tone={tone}>{SEV[sev].n}</StatusChip>;
}

export function LayerStatusChip({ status, etaLabel }: { status: string; etaLabel?: string }) {
  const tone: ChipTone =
    status === 'Ready' || status === 'Received' || status === 'Live'
      ? 'ok'
      : status === 'Inferred'
        ? 'warn'
        : status === 'Loading' || status === 'Requested' || status === 'In progress'
          ? 'ld'
          : 'neutral';
  return <StatusChip tone={tone}>{etaLabel ?? status}</StatusChip>;
}

export function SimulatedBadge({ phase2 = false }: { phase2?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      {phase2 && <StatusChip tone="phase2">Phase 2</StatusChip>}
      <StatusChip tone="sim">Simulated</StatusChip>
    </span>
  );
}
