import type { FirstLaunchStep, LogLine } from '@/lib/db/types';

export function parseStepLogs(step: FirstLaunchStep): LogLine[] {
  return step.logs;
}

export function mergeStepLogs(steps: FirstLaunchStep[]): LogLine[] {
  return steps
    .flatMap(parseStepLogs)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export type FirstLaunchStatus = 'pending' | 'running' | 'done' | 'error';

export function stepStatus(step: FirstLaunchStep): FirstLaunchStatus {
  if (step.lastError !== null) return 'error';
  if (step.completedAt !== null) return 'done';
  if (step.startedAt !== null) return 'running';
  return 'pending';
}

export type FirstLaunchOverall = 'empty' | FirstLaunchStatus;

export function overallStatus(steps: FirstLaunchStep[]): FirstLaunchOverall {
  if (steps.length === 0) return 'empty';
  const statuses = steps.map(stepStatus);
  if (statuses.some((s) => s === 'error')) return 'error';
  if (statuses.every((s) => s === 'done')) return 'done';
  if (statuses.some((s) => s === 'running')) return 'running';
  return 'pending';
}
