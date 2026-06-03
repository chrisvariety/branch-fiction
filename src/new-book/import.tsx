import {
  IconAlertTriangle,
  IconBook,
  IconCheck,
  IconCircle,
  IconCircleCheck,
  IconCopy,
  IconDots,
  IconHandStop,
  IconLoader2,
  IconPlayerPlay,
  IconAlertCircle,
  IconChevronRight
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { openBookWindow } from '@/book/open-book';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { entitySelectionQueryOptions } from '@/hooks/queries/entity-selection';
import {
  importProgressQueryOptions,
  type ImportProgress
} from '@/hooks/queries/import-progress';
import {
  importUsageSummaryQueryOptions,
  type ImportUsageSummary
} from '@/hooks/queries/import-usage-summary';
import { useWindowTitle } from '@/hooks/use-window-title';
import { broadcastInvalidate } from '@/lib/cross-window-invalidate';
import { deleteBookImportById } from '@/lib/db/models/book-import/delete-book-import';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { updateBookImportById } from '@/lib/db/models/book-import/update-book-import';
import { deleteBookById } from '@/lib/db/models/book/delete-book';
import type { LogLine } from '@/lib/db/types';
import { cancelImport, resumeImport } from '@/lib/pipeline';
import { cn } from '@/lib/utils';
import { EntitySelectionPane } from '@/new-book/entity-selection';
import { NotifyButton } from '@/new-book/notify-button';
import {
  ImportEstimateRow,
  ProjectionConfirmActions
} from '@/new-book/projection-confirmation';
import { TypingNarrative } from '@/new-book/typing-narrative';

type StepInfo = ImportProgress['steps'][number];

type ChapterKind = 'steps' | 'select_characters' | 'select_places' | 'finis';

type Chapter = { id: string; title: string; kind: ChapterKind; stepIds: string[] };

const FINAL_CHAPTER_ID = 'finis';
const SELECT_CHARACTERS_ID = 'select_characters';
const SELECT_PLACES_ID = 'select_places';

const CHAPTERS: Chapter[] = [
  {
    id: 'reading',
    title: 'Reading the text',
    kind: 'steps',
    stepIds: [
      'imported_book',
      'preliminary_scenes_preview',
      'preliminary_scenes',
      'extract_broad_categories',
      'extract_entities',
      'categorize_entities',
      'remove_ambiguous_entity_names',
      'finalize_scenes'
    ]
  },
  {
    id: 'mapping',
    title: 'Mapping the cast',
    kind: 'steps',
    stepIds: [
      'extract_styles',
      'estimate_significance',
      'extract_appellations',
      'summarize_appellations',
      'extract_relationships',
      'extract_entity_attributes'
    ]
  },
  {
    id: 'structure',
    title: 'Finding the structure',
    kind: 'steps',
    stepIds: ['extract_hierarchy', 'determine_minors', 'calculate_significance']
  },
  {
    id: SELECT_CHARACTERS_ID,
    title: 'Choose your characters',
    kind: 'select_characters',
    stepIds: []
  },
  {
    id: SELECT_PLACES_ID,
    title: 'Choose your locations',
    kind: 'select_places',
    stepIds: []
  },
  {
    id: 'arcs',
    title: 'Tracing the arcs',
    kind: 'steps',
    stepIds: [
      'extract_related_relationship_arc',
      'extract_relationship_arc',
      'extract_appellation_arc',
      'extract_entity_appearances_batch',
      'character_arc',
      'place_arc'
    ]
  },
  {
    id: 'finalizing',
    title: 'Identifying',
    kind: 'steps',
    stepIds: ['character_identity_tags', 'place_identity_tags']
  },
  {
    id: FINAL_CHAPTER_ID,
    title: 'Fin',
    kind: 'finis',
    stepIds: []
  }
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

type ChapterStatus = 'pending' | 'running' | 'awaiting' | 'completed' | 'failed';

function chapterHasContent(
  chapter: Chapter,
  stepById: Map<string, StepInfo>,
  stalled: boolean
): boolean {
  return chapter.stepIds.some((id) => {
    const step = stepById.get(id);
    if (!step) return false;
    const isActive = step.status === 'running' && !stalled;
    return (step.narrative ?? []).length > 0 || isActive;
  });
}

function chapterNotBegun(
  chapter: Chapter,
  index: number,
  stepById: Map<string, StepInfo>,
  stalled: boolean
): boolean {
  return (
    chapter.kind === 'steps' &&
    index > 0 &&
    !chapterHasContent(chapter, stepById, stalled)
  );
}

function getChapterStatus(chapterSteps: (StepInfo | undefined)[]): ChapterStatus {
  const present = chapterSteps.filter((s): s is StepInfo => s != null);
  if (present.some((s) => s.status === 'failed')) return 'failed';
  if (present.some((s) => s.status === 'running')) return 'running';
  if (
    present.length > 0 &&
    present.every((s) => s.status === 'completed' || s.status === 'skipped')
  ) {
    return 'completed';
  }
  return 'pending';
}

function phaseChapterIdsFor(status: ImportProgress['status'] | undefined): string[] {
  if (
    status === 'pending' ||
    status === 'projection' ||
    status === 'awaiting_projection'
  ) {
    return ['reading'];
  }
  if (status === 'extract') return ['reading', 'mapping', 'structure'];
  if (status === 'arc') return ['arcs', 'finalizing'];
  if (status === 'failed')
    return ['reading', 'mapping', 'structure', 'arcs', 'finalizing'];
  return [];
}

function getSelectionChapterStatus(
  importStatus: ImportProgress['status'],
  stepById: Map<string, StepInfo>
): ChapterStatus {
  if (importStatus === 'awaiting_selection') return 'awaiting';
  if (importStatus === 'completed') return 'completed';
  if (stepById.get('calculate_significance')?.status === 'completed') return 'completed';
  return 'pending';
}

export function ImportPage() {
  const { bookImportId } = useParams({ strict: false });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [resuming, setResuming] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [displayedChapterId, setDisplayedChapterId] = useState<string | null>(null);
  const [turning, setTurning] = useState<{
    fromId: string;
    toId: string;
    direction: 'forward' | 'backward';
  } | null>(null);
  const [flipAnimating, setFlipAnimating] = useState(false);
  const prevFlippedRef = useRef<boolean | null>(null);
  const prevAutoChapterIdRef = useRef<string | null>(null);
  const selectionDirtyRef = useRef(false);

  const markSelectionChanged = useCallback(() => {
    selectionDirtyRef.current = true;
  }, []);

  const { data: progress, isLoading } = useQuery({
    ...importProgressQueryOptions(bookImportId ?? ''),
    enabled: !!bookImportId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (resuming) return 500;
      if (status === 'completed' || status === 'failed') {
        const hasRunning = query.state.data?.steps.some((s) => s.status === 'running');
        return hasRunning ? 2000 : false;
      }
      return status === 'pending' ||
        status === 'projection' ||
        status === 'extract' ||
        status === 'arc'
        ? 2000
        : false;
    }
  });

  useWindowTitle(progress?.title ?? 'New Book');

  useEffect(() => {
    if (!progress || !resuming) return;
    if (progress.isActive || progress.status === 'completed') {
      setResuming(false);
    }
  }, [progress, resuming]);

  const stepById = useMemo(
    () => new Map((progress?.steps ?? []).map((s) => [s.stepId, s])),
    [progress?.steps]
  );

  const calculateSignificanceDone =
    stepById.get('calculate_significance')?.status === 'completed';

  const { data: placesSelectionData } = useQuery({
    ...entitySelectionQueryOptions(bookImportId ?? '', progress?.bookId ?? '', 'PLACE'),
    enabled: !!bookImportId && !!progress?.bookId && calculateSignificanceDone
  });

  const { data: projectionUsage } = useQuery({
    ...importUsageSummaryQueryOptions(bookImportId ?? ''),
    enabled: !!bookImportId && progress?.status === 'awaiting_projection'
  });

  const cacheWarning =
    !!projectionUsage &&
    projectionUsage.calls >= 2 &&
    projectionUsage.callsWithCacheRead === 0;

  // Skip places selection when all candidates are already PRIMARY (or there are none).
  const skipPlacesSelection = useMemo(() => {
    if (!placesSelectionData) return false;
    if (placesSelectionData.length === 0) return true;
    return placesSelectionData.every((e) => e.significanceTier === 'PRIMARY');
  }, [placesSelectionData]);

  const visibleChapters = useMemo(
    () =>
      skipPlacesSelection ? CHAPTERS.filter((c) => c.id !== SELECT_PLACES_ID) : CHAPTERS,
    [skipPlacesSelection]
  );

  const autoChapterId = useMemo(() => {
    const status = progress?.status;
    if (status === 'completed') return FINAL_CHAPTER_ID;
    if (status === 'awaiting_selection') return SELECT_CHARACTERS_ID;

    const phaseChapterIds = phaseChapterIdsFor(status);
    const phaseChapters = phaseChapterIds
      .map((id) => visibleChapters.find((c) => c.id === id))
      .filter((c): c is Chapter => !!c);

    for (const c of phaseChapters) {
      if (getChapterStatus(c.stepIds.map((id) => stepById.get(id))) === 'failed') {
        return c.id;
      }
    }
    for (const c of phaseChapters) {
      if (getChapterStatus(c.stepIds.map((id) => stepById.get(id))) === 'running') {
        return c.id;
      }
    }
    for (const c of phaseChapters) {
      if (getChapterStatus(c.stepIds.map((id) => stepById.get(id))) !== 'completed') {
        return c.id;
      }
    }
    return phaseChapters[phaseChapters.length - 1]?.id ?? 'reading';
  }, [stepById, progress?.status, visibleChapters]);

  useEffect(() => {
    if (displayedChapterId === null && progress) {
      setDisplayedChapterId(autoChapterId);
    }
  }, [displayedChapterId, autoChapterId, progress]);

  useEffect(() => {
    if (!bookImportId || !progress?.bookId) return;
    if (progress.status !== 'awaiting_selection') return;
    void queryClient.prefetchQuery(
      entitySelectionQueryOptions(bookImportId, progress.bookId, 'CHARACTER')
    );
    void queryClient.prefetchQuery(
      entitySelectionQueryOptions(bookImportId, progress.bookId, 'PLACE')
    );
  }, [bookImportId, progress?.bookId, progress?.status, queryClient]);

  const inProjectionPhase =
    !progress?.autoConfirmProjection &&
    (progress?.status === 'pending' || progress?.status === 'projection');

  const flippedValue = !!(
    (progress?.isActive && !inProjectionPhase) ||
    progress?.status === 'completed' ||
    progress?.status === 'awaiting_selection' ||
    (resuming && !inProjectionPhase)
  );

  useEffect(() => {
    if (!progress) return;
    if (prevFlippedRef.current === null) {
      prevFlippedRef.current = flippedValue;
      return;
    }
    if (prevFlippedRef.current !== flippedValue) {
      prevFlippedRef.current = flippedValue;
      setFlipAnimating(true);
    }
  }, [flippedValue, progress]);

  const goToChapter = useCallback(
    (targetId: string) => {
      if (turning) return;
      if (!displayedChapterId || targetId === displayedChapterId) return;
      const currentIdx = visibleChapters.findIndex((c) => c.id === displayedChapterId);
      const targetIdx = visibleChapters.findIndex((c) => c.id === targetId);
      if (currentIdx === -1 || targetIdx === -1) return;
      const direction: 'forward' | 'backward' =
        targetIdx > currentIdx ? 'forward' : 'backward';
      setTurning({ fromId: displayedChapterId, toId: targetId, direction });
      if (direction === 'forward') {
        setDisplayedChapterId(targetId);
      }
    },
    [turning, displayedChapterId, visibleChapters]
  );

  useEffect(() => {
    if (!progress || displayedChapterId === null) return;
    if (prevAutoChapterIdRef.current === null) {
      prevAutoChapterIdRef.current = autoChapterId;
      return;
    }
    if (prevAutoChapterIdRef.current === autoChapterId) return;
    if (turning) return;
    prevAutoChapterIdRef.current = autoChapterId;
    if (autoChapterId !== displayedChapterId) {
      goToChapter(autoChapterId);
    }
  }, [autoChapterId, displayedChapterId, turning, progress, goToChapter]);

  const handleUserSelectChapter = useCallback(
    (id: string) => {
      goToChapter(id);
    },
    [goToChapter]
  );

  const handleContinueAfterPlaces = useCallback(async () => {
    if (!bookImportId) return;
    // Reopened a finished book to re-select but nothing changed, bounce outta here
    if (progress?.bookStatus === 'completed' && !selectionDirtyRef.current) {
      await updateBookImportById(bookImportId, { status: 'completed' });
      void broadcastInvalidate();
      if (progress.bookId) await openBookWindow(progress.bookId);
      await getCurrentWindow().close();
      return;
    }
    setResuming(true);
    await updateBookImportById(bookImportId, { status: 'arc' });
    await queryClient.invalidateQueries({
      queryKey: ['import-progress', bookImportId]
    });
    void broadcastInvalidate();
    void resumeImport(bookImportId);
  }, [bookImportId, queryClient, progress?.bookStatus, progress?.bookId]);

  const handleContinueToPlaces = useCallback(() => {
    if (skipPlacesSelection) {
      void handleContinueAfterPlaces();
      return;
    }
    goToChapter(SELECT_PLACES_ID);
  }, [goToChapter, handleContinueAfterPlaces, skipPlacesSelection]);

  const notifyEnabled = !!progress?.notificationsEnabled;
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!notifyEnabled || !bookImportId || !progress) return;
    const prev = prevStatusRef.current;
    const status = progress.status;
    prevStatusRef.current = status;
    if (prev === null || prev === status) return;
    const title = progress.title ?? 'Your book';
    if (status === 'completed') {
      sendNotification({ title: 'Import complete', body: `${title} is ready to read.` });
    } else if (status === 'failed') {
      sendNotification({
        title: 'Import failed',
        body: `${title} could not be imported.`
      });
    } else if (status === 'awaiting_selection') {
      sendNotification({
        title: 'Selection ready',
        body: `Choose primary characters and places for ${title}.`
      });
    }
  }, [notifyEnabled, bookImportId, progress?.status, progress?.title]);

  if (isLoading || !progress) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isFailed = progress.status === 'failed';
  const isComplete = progress.status === 'completed';
  const isStalled =
    (progress.status === 'pending' ||
      progress.status === 'projection' ||
      progress.status === 'extract' ||
      progress.status === 'arc') &&
    !progress.isActive;
  const canResume = isFailed || isStalled;
  const showNotifyButton = !isComplete && !isFailed;
  const flipped = flippedValue;
  const suppressCursor = flipAnimating || !!turning;

  const effectiveChapterId = displayedChapterId ?? autoChapterId;
  const chapterIndex = Math.max(
    0,
    visibleChapters.findIndex((c) => c.id === effectiveChapterId)
  );
  const selectedChapter = visibleChapters[chapterIndex] ?? visibleChapters[0];
  const turningFromChapter = turning
    ? (visibleChapters.find((c) => c.id === turning.fromId) ?? null)
    : null;
  const turningToChapter = turning
    ? (visibleChapters.find((c) => c.id === turning.toId) ?? null)
    : null;
  const turningFromIndex = turningFromChapter
    ? visibleChapters.findIndex((c) => c.id === turningFromChapter.id)
    : -1;
  const turningToIndex = turningToChapter
    ? visibleChapters.findIndex((c) => c.id === turningToChapter.id)
    : -1;

  const failedStep = progress.steps.find((s) => s.status === 'failed');

  const logs = progress.steps
    .flatMap((s) => s.logs)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const preImport = inProjectionPhase || progress.status === 'awaiting_projection';

  const handleCancel = async () => {
    if (!bookImportId) return;
    const confirmed = await ask('Are you sure you want to cancel this import?', {
      title: 'Cancel Import',
      kind: 'warning',
      okLabel: 'Cancel Import',
      cancelLabel: 'Keep Running'
    });
    if (!confirmed) return;
    await cancelImport(bookImportId);
    const bookImport = await getBookImportById(bookImportId);
    if (bookImport?.bookId) {
      await deleteBookById(bookImport.bookId);
    }
    await deleteBookImportById(bookImportId);
    await broadcastInvalidate();
    if (preImport) {
      await navigate({ to: '/' });
    } else {
      await getCurrentWindow().close();
    }
  };

  const handleResume = () => {
    if (!bookImportId) return;
    setResuming(true);
    void resumeImport(bookImportId);
  };

  const handleRestart = async () => {
    if (!bookImportId) return;
    const confirmed = await ask(
      'This discards the current import so you can start over with a different provider.',
      {
        title: 'Restart Import',
        kind: 'warning',
        okLabel: 'Restart Import',
        cancelLabel: 'Keep This Import'
      }
    );
    if (!confirmed) return;
    await cancelImport(bookImportId);
    const bookImport = await getBookImportById(bookImportId);
    if (bookImport?.bookId) {
      await deleteBookById(bookImport.bookId);
    }
    await deleteBookImportById(bookImportId);
    await broadcastInvalidate();
    await navigate({ to: '/' });
  };

  const handleConfirmCalibration = async () => {
    if (!bookImportId) return;
    setResuming(true);
    await updateBookImportById(bookImportId, { status: 'extract' });
    await queryClient.invalidateQueries({
      queryKey: ['import-progress', bookImportId]
    });
    void broadcastInvalidate();
    void resumeImport(bookImportId);
  };

  const handleNotify = async (enabled: boolean) => {
    if (!bookImportId) return;
    await updateBookImportById(bookImportId, { notificationsEnabled: enabled });
    void queryClient.invalidateQueries({
      queryKey: ['import-progress', bookImportId]
    });
    void broadcastInvalidate();
  };

  return (
    <div className="relative flex flex-1">
      <div className="flex w-full flex-1 perspective-[2400px]">
        <div className="relative size-full ring-1 ring-border transform-3d">
          <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden bg-card book-page-gradient-mirror">
            <CoverPane imageUrl={progress.imageUrl} title={progress.title} />
          </div>

          <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden bg-card book-page-gradient">
            <ChapterDetailPane
              chapter={selectedChapter}
              index={chapterIndex}
              stepById={stepById}
              stalled={isStalled}
              suppressCursor={suppressCursor}
              importComplete={isComplete}
              bookImportId={bookImportId ?? ''}
              bookId={progress.bookId}
              bookName={progress.title}
              importStatus={progress.status}
              onContinueToPlaces={handleContinueToPlaces}
              onContinueAfterPlaces={handleContinueAfterPlaces}
              onSelectionChange={markSelectionChanged}
            />
          </div>

          <div
            className={cn(
              'absolute top-0 right-0 h-full w-1/2 origin-left transition-transform duration-900 ease-[cubic-bezier(0.645,0.045,0.355,1)] will-change-transform transform-3d',
              flipped && '-rotate-y-180'
            )}
            onTransitionEnd={(e) => {
              if (e.propertyName === 'transform') setFlipAnimating(false);
            }}
          >
            <div
              className="absolute inset-0 bg-card book-page-gradient backface-hidden"
              style={{ transform: 'translateZ(1px)' }}
            >
              <ActionsPane
                title={progress.title}
                status={progress.status}
                resuming={resuming}
                isStalled={isStalled}
                notifyEnabled={notifyEnabled}
                canResume={canResume}
                showNotifyButton={showNotifyButton}
                failedStep={failedStep}
                completedCount={progress.completedCount}
                totalCount={progress.totalCount}
                etaMinSeconds={progress.etaMinSeconds}
                etaMaxSeconds={progress.etaMaxSeconds}
                costMinCents={progress.costMinCents}
                costMaxCents={progress.costMaxCents}
                projectionBehavior={progress.projectionBehavior}
                inProjectionPhase={inProjectionPhase}
                projectionSteps={progress.steps}
                cacheWarning={cacheWarning}
                onResume={handleResume}
                onNotify={handleNotify}
                onConfirmCalibration={handleConfirmCalibration}
                onCancel={handleCancel}
                onRestart={handleRestart}
              />
            </div>

            <div
              className="absolute inset-0 bg-card book-page-gradient-mirror backface-hidden"
              style={{ transform: 'rotateY(180deg) translateZ(1px)' }}
            >
              <ContentsPane
                chapters={visibleChapters}
                stepById={stepById}
                stalled={isStalled}
                selectedId={selectedChapter.id}
                importStatus={progress.status}
                bookName={progress.title}
                onSelect={handleUserSelectChapter}
              />
            </div>
          </div>

          {turning && turningFromChapter && turningToChapter && (
            <div
              key={`${turning.fromId}-${turning.toId}`}
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0 z-2 w-1/2 origin-left will-change-transform transform-3d',
                turning.direction === 'forward'
                  ? 'animate-page-turn-forward'
                  : 'animate-page-turn-backward'
              )}
              onAnimationEnd={() => {
                if (turning.direction === 'backward') {
                  setDisplayedChapterId(turning.toId);
                }
                setTurning(null);
              }}
            >
              <div
                className="absolute inset-0 bg-card book-page-gradient backface-hidden"
                style={{ transform: 'translateZ(1px)' }}
              >
                <ChapterDetailPane
                  chapter={
                    turning.direction === 'forward'
                      ? turningFromChapter
                      : turningToChapter
                  }
                  index={
                    turning.direction === 'forward' ? turningFromIndex : turningToIndex
                  }
                  stepById={stepById}
                  stalled={isStalled}
                  suppressCursor={suppressCursor}
                  importComplete={isComplete}
                  bookImportId={bookImportId ?? ''}
                  bookId={progress.bookId}
                  bookName={progress.title}
                  importStatus={progress.status}
                  onContinueToPlaces={handleContinueToPlaces}
                  onContinueAfterPlaces={handleContinueAfterPlaces}
                  onSelectionChange={markSelectionChanged}
                />
              </div>
              <div
                className="absolute inset-0 bg-card book-page-gradient-mirror backface-hidden"
                style={{ transform: 'rotateY(180deg) translateZ(1px)' }}
              >
                <ContentsPane
                  importStatus={progress.status}
                  chapters={visibleChapters}
                  stepById={stepById}
                  stalled={isStalled}
                  selectedId={selectedChapter.id}
                  bookName={progress.title}
                  onSelect={handleUserSelectChapter}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute top-10 right-3 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center justify-center p-1 text-muted-foreground hover:text-foreground">
            <IconDots className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowStats(true)}>
              View Stats
            </DropdownMenuItem>
            {logs.length > 0 && (
              <DropdownMenuItem onClick={() => setShowLogs(true)}>
                View Logs
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleCancel}>
              Cancel Import
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={showLogs} onOpenChange={setShowLogs}>
        <DialogContent
          className="flex h-[70vh] flex-col gap-3 p-0 sm:max-w-3xl"
          initialFocus={false}
        >
          <div className="flex items-center gap-2 px-4 pt-4 pr-12">
            <DialogTitle className="flex-1">Import logs</DialogTitle>
            <CopyLogsButton logs={logs} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <LogPane logs={logs} />
          </div>
        </DialogContent>
      </Dialog>

      <StatsDialog
        open={showStats}
        onOpenChange={setShowStats}
        bookImportId={bookImportId ?? ''}
      />
    </div>
  );
}

function CoverPane({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  if (imageUrl) {
    return (
      <div className="relative size-full overflow-hidden">
        <img
          src={imageUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-110 object-cover blur-xl"
        />
        <img src={imageUrl} alt={title} className="relative size-full object-contain" />
      </div>
    );
  }
  return (
    <div className="flex size-full items-center justify-center bg-muted/40">
      <IconBook className="size-16 text-muted-foreground/40" />
    </div>
  );
}

function ActionsPane({
  title,
  status,
  resuming,
  isStalled,
  notifyEnabled,
  canResume,
  showNotifyButton,
  failedStep,
  completedCount,
  totalCount,
  etaMinSeconds,
  etaMaxSeconds,
  costMinCents,
  costMaxCents,
  projectionBehavior,
  inProjectionPhase,
  projectionSteps,
  cacheWarning,
  onResume,
  onNotify,
  onConfirmCalibration,
  onCancel,
  onRestart
}: {
  title: string;
  status: ImportProgress['status'];
  resuming: boolean;
  isStalled: boolean;
  notifyEnabled: boolean;
  canResume: boolean;
  showNotifyButton: boolean;
  failedStep: StepInfo | undefined;
  completedCount: number;
  totalCount: number;
  etaMinSeconds: number | null;
  etaMaxSeconds: number | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  projectionBehavior: 'normal' | 'unknown' | null;
  inProjectionPhase: boolean;
  projectionSteps: StepInfo[];
  cacheWarning: boolean;
  onResume: () => void;
  onNotify: (enabled: boolean) => void;
  onConfirmCalibration: () => void;
  onCancel: () => void;
  onRestart: () => void;
}) {
  const awaitingProjection = status === 'awaiting_projection';
  const hideStatusChrome = awaitingProjection || inProjectionPhase;

  return (
    <div className="flex size-full flex-col items-center gap-5 px-10 pt-10 pb-10 text-center">
      <div className="flex flex-col items-center gap-3">
        <h2 className="font-serif text-xl leading-tight tracking-tight text-balance">
          {title}
        </h2>
        <div className="h-px w-8 bg-border" />
        {inProjectionPhase ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {canResume
              ? 'We will parse your book and extract a few scenes to get an idea of cost & time the full import will take. This can take a few minutes depending on the LLM provider.'
              : "We're parsing your book and extracting a few scenes to get an idea of cost & time the full import will take. This can take a few minutes depending on the LLM provider."}
          </p>
        ) : (
          !hideStatusChrome && <StatusBadge status={status} stalled={isStalled} />
        )}
      </div>

      {failedStep?.lastError && (
        <div className="flex w-full max-w-full flex-col gap-2 border border-destructive/50 bg-destructive/10 p-3 text-left">
          <div className="flex items-start gap-2">
            <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{failedStep.lastError}</p>
          </div>
          <FailedStepGuidance onRestart={onRestart} />
        </div>
      )}

      {inProjectionPhase ? (
        <ProjectionProgress steps={projectionSteps} stalled={isStalled} />
      ) : awaitingProjection ? (
        <ImportEstimateRow
          etaMinSeconds={etaMinSeconds}
          etaMaxSeconds={etaMaxSeconds}
          costMinCents={costMinCents}
          costMaxCents={costMaxCents}
          behavior={projectionBehavior}
        />
      ) : (
        <p className="font-serif text-xs text-muted-foreground tabular-nums">
          {completedCount} of {totalCount} steps complete
        </p>
      )}

      <div className="flex flex-col items-center gap-2">
        {inProjectionPhase ? (
          <>
            {canResume && (
              <button
                type="button"
                disabled={resuming}
                className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                onClick={onResume}
              >
                {resuming ? (
                  'Resuming'
                ) : (
                  <>
                    <IconPlayerPlay className="size-3.5" />
                    Resume
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              className="mt-4 font-serif text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={onCancel}
            >
              Cancel
            </button>
          </>
        ) : awaitingProjection ? (
          <ProjectionConfirmActions
            resuming={resuming}
            costMinCents={costMinCents}
            costMaxCents={costMaxCents}
            cacheWarning={cacheWarning}
            notifyEnabled={notifyEnabled}
            onBegin={onConfirmCalibration}
            onCancel={onCancel}
            onNotify={onNotify}
          />
        ) : (
          canResume && (
            <button
              type="button"
              disabled={resuming}
              className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              onClick={onResume}
            >
              {resuming ? (
                'Resuming'
              ) : (
                <>
                  <IconPlayerPlay className="size-3.5" />
                  Resume import
                </>
              )}
            </button>
          )
        )}
        {!hideStatusChrome && showNotifyButton && (
          <NotifyButton enabled={notifyEnabled} onChange={onNotify} />
        )}
      </div>
    </div>
  );
}

function FailedStepGuidance({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="flex flex-col gap-2 border-t border-destructive/30 pt-2 pl-6 font-serif text-xs leading-relaxed text-destructive/90">
      <p>
        <span className="font-medium">Try resuming first.</span> Most errors clear up on a
        retry.
      </p>
      <p>
        If the same error happens again, it's likely a problem with the LLM provider.{' '}
        <button
          type="button"
          onClick={onRestart}
          className="underline underline-offset-2 hover:opacity-80"
        >
          Restart the import
        </button>{' '}
        and choose a different provider, so the whole book is processed by one model from
        the start.
      </p>
      <p className="text-destructive/70">
        Advanced: open the menu (
        <IconDots className="inline size-3 align-text-bottom" />) at the top right and
        choose <span className="font-medium">View Logs</span> for more behind-the-scenes
        detail. The logs are somewhat technical, but they can hint at what went wrong.
      </p>
    </div>
  );
}

const PROJECTION_STEP_LABELS: { id: string; label: string }[] = [
  { id: 'imported_book', label: 'Parsing book' },
  { id: 'preliminary_scenes_preview', label: 'Sampling scenes' }
];

function ProjectionProgress({ steps, stalled }: { steps: StepInfo[]; stalled: boolean }) {
  const stepById = new Map(steps.map((s) => [s.stepId, s]));
  return (
    <div className="flex w-full flex-col">
      {PROJECTION_STEP_LABELS.map((row, i) => {
        const raw = stepById.get(row.id)?.status ?? 'pending';
        const status: ChapterStatus =
          raw === 'completed'
            ? 'completed'
            : raw === 'running'
              ? 'running'
              : raw === 'failed'
                ? 'failed'
                : 'pending';
        return (
          <div
            key={row.id}
            className={cn(
              'flex items-baseline gap-4 py-3 text-left font-serif transition-colors',
              status === 'completed' ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            <span className="w-8 shrink-0 text-xs tracking-widest tabular-nums">
              {(ROMAN[i] ?? `${i + 1}`).toLowerCase()}
            </span>
            <span
              className={cn(
                'flex-1 truncate text-sm',
                status === 'pending' && 'text-muted-foreground/60'
              )}
            >
              {row.label}
            </span>
            <ChapterStatusGlyph status={status} stalled={stalled} />
          </div>
        );
      })}
    </div>
  );
}

function ContentsPane({
  chapters,
  stepById,
  stalled,
  selectedId,
  importStatus,
  bookName,
  onSelect
}: {
  chapters: Chapter[];
  stepById: Map<string, StepInfo>;
  stalled: boolean;
  selectedId: string;
  importStatus: ImportProgress['status'];
  bookName: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex size-full flex-col px-10 py-10">
      <p className="text-center font-serif text-sm text-balance text-muted-foreground italic">
        {bookName}
      </p>
      <h2 className="mt-2 text-center font-serif text-sm tracking-[0.4em] uppercase">
        Contents
      </h2>
      <div className="mx-auto mt-2 h-px w-8 bg-border" />
      <div className="mt-6 flex flex-1 flex-col">
        {chapters.map((chapter, i) => {
          const chapterSteps = chapter.stepIds.map((id) => stepById.get(id));
          const status: ChapterStatus =
            chapter.kind === 'finis'
              ? importStatus === 'completed'
                ? 'completed'
                : 'pending'
              : chapter.kind === 'select_characters' || chapter.kind === 'select_places'
                ? getSelectionChapterStatus(importStatus, stepById)
                : getChapterStatus(chapterSteps);
          const isSelected = chapter.id === selectedId;
          const isSelectionChapter =
            chapter.kind === 'select_characters' || chapter.kind === 'select_places';
          const notBegun = isSelectionChapter
            ? status === 'pending'
            : chapterNotBegun(chapter, i, stepById, stalled);
          return (
            <button
              type="button"
              key={chapter.id}
              disabled={notBegun}
              onClick={() => onSelect(chapter.id)}
              className={cn(
                'group flex items-baseline gap-4 py-3 text-left font-serif transition-colors',
                isSelected ? 'text-foreground' : 'text-muted-foreground',
                !isSelected && !notBegun && 'hover:text-foreground',
                notBegun && 'cursor-default'
              )}
            >
              <span
                className={cn(
                  'w-8 shrink-0 font-serif text-xs tracking-widest uppercase tabular-nums',
                  status === 'failed' && 'text-destructive'
                )}
              >
                {ROMAN[i] ?? `${i + 1}`}
              </span>
              <span
                className={cn(
                  'flex-1 truncate text-sm',
                  status === 'pending' && 'text-muted-foreground/60'
                )}
              >
                {chapter.title}
              </span>
              <ChapterStatusGlyph status={status} stalled={stalled} />
            </button>
          );
        })}
      </div>
      <div className="mt-auto text-center font-serif text-xs text-muted-foreground/60 tabular-nums">
        2
      </div>
    </div>
  );
}

function ChapterStatusGlyph({
  status,
  stalled
}: {
  status: ChapterStatus;
  stalled: boolean;
}) {
  if (status === 'completed') {
    return <IconCircleCheck className="size-3.5 shrink-0 text-primary/70" />;
  }
  if (status === 'failed') {
    return <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />;
  }
  if (status === 'awaiting') {
    return <IconHandStop className="size-3.5 shrink-0 text-primary" />;
  }
  if (status === 'running' && !stalled) {
    return <IconLoader2 className="size-3.5 shrink-0 animate-spin text-primary" />;
  }
  return <IconCircle className="size-3.5 shrink-0 text-muted-foreground/30" />;
}

function ChapterDetailPane({
  chapter,
  index,
  stepById,
  stalled,
  suppressCursor,
  importComplete,
  bookImportId,
  bookId,
  bookName,
  importStatus,
  onContinueToPlaces,
  onContinueAfterPlaces,
  onSelectionChange
}: {
  chapter: Chapter;
  index: number;
  stepById: Map<string, StepInfo>;
  stalled: boolean;
  suppressCursor: boolean;
  importComplete: boolean;
  bookImportId: string;
  bookId: string | null | undefined;
  bookName: string;
  importStatus: ImportProgress['status'];
  onContinueToPlaces: () => void;
  onContinueAfterPlaces: () => void;
  onSelectionChange?: () => void;
}) {
  const isFinalChapter = chapter.kind === 'finis';
  const isSelectionChapter =
    chapter.kind === 'select_characters' || chapter.kind === 'select_places';
  const showBlankPlaceholder = chapterNotBegun(chapter, index, stepById, stalled);
  const selectionLocked = importStatus !== 'awaiting_selection';
  return (
    <div
      className={cn(
        'flex size-full flex-col py-10',
        isSelectionChapter ? 'px-3' : 'px-10'
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="font-serif text-lg tracking-[0.3em] uppercase">
          {ROMAN[index] ?? `${index + 1}`}
        </span>
        <h2 className="font-serif text-xl tracking-tight text-balance">
          {chapter.title}
        </h2>
        <div className="h-px w-8 bg-border" />
      </div>
      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {isFinalChapter ? (
          <FinaleContent
            importComplete={importComplete}
            bookId={bookId}
            bookName={bookName}
          />
        ) : isSelectionChapter ? (
          bookId ? (
            <EntitySelectionPane
              bookImportId={bookImportId}
              bookId={bookId}
              entityType={chapter.kind === 'select_characters' ? 'CHARACTER' : 'PLACE'}
              primaryHeading="Primary"
              otherHeading="Other"
              locked={selectionLocked}
              onChanged={onSelectionChange}
              onContinue={
                chapter.kind === 'select_characters'
                  ? onContinueToPlaces
                  : onContinueAfterPlaces
              }
              continueLabel={
                chapter.kind === 'select_characters' ? 'Continue' : 'Continue'
              }
            />
          ) : (
            <BlankChapterPlaceholder />
          )
        ) : showBlankPlaceholder ? (
          <BlankChapterPlaceholder />
        ) : (
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {chapter.stepIds.map((id) => (
              <SubstepRow
                key={id}
                step={stepById.get(id)}
                stalled={stalled}
                suppressCursor={suppressCursor}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mt-auto pt-4 text-center font-serif text-xs text-muted-foreground/60 tabular-nums">
        3
      </div>
    </div>
  );
}

function BlankChapterPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center">
      <p className="font-serif text-sm text-muted-foreground italic">
        This chapter has yet to begin. Check back soon!
      </p>
    </div>
  );
}

function FinaleContent({
  importComplete,
  bookId,
  bookName
}: {
  importComplete: boolean;
  bookId: string | null | undefined;
  bookName: string;
}) {
  if (!importComplete || !bookId) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center">
        <p className="font-serif text-sm text-muted-foreground italic">
          This is the end. The import process is not complete yet though, check back soon!
        </p>
      </div>
    );
  }
  const handleLaunch = async () => {
    await openBookWindow(bookId);
    await getCurrentWindow().close();
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <p className="font-serif text-sm">{bookName} has been imported successfully.</p>
      <button
        type="button"
        onClick={() => void handleLaunch()}
        className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Launch
      </button>
    </div>
  );
}

function SubstepRow({
  step,
  stalled,
  suppressCursor
}: {
  step: StepInfo | undefined;
  stalled: boolean;
  suppressCursor: boolean;
}) {
  const status = step?.status ?? 'pending';
  const narrative = step?.narrative ?? [];
  const isActive = status === 'running' && !stalled;

  if (narrative.length === 0 && !isActive) return null;

  const typingLines = narrative.filter((l) => l.kind !== 'error');
  const errorLines = narrative.filter((l) => l.kind === 'error');

  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 font-serif text-sm leading-snug',
        status === 'failed' ? 'text-destructive' : 'text-foreground'
      )}
    >
      <TypingNarrative
        lines={typingLines}
        isActive={isActive}
        suppressCursor={suppressCursor}
      />
      {errorLines.map((line) => (
        <ErrorNarrativeLine key={line.id} text={line.text} />
      ))}
    </div>
  );
}

type ParsedErrorDetail =
  | { kind: 'serialized'; name?: string; message?: string; stack?: string }
  | { kind: 'raw'; text: string };

function parseErrorDetail(detail: string): ParsedErrorDetail {
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const { name, message, stack } = parsed as Record<string, unknown>;
      const looksLikeError =
        typeof name === 'string' ||
        typeof message === 'string' ||
        typeof stack === 'string';
      if (looksLikeError) {
        return {
          kind: 'serialized',
          name: typeof name === 'string' ? name : undefined,
          message: typeof message === 'string' ? message : undefined,
          stack: typeof stack === 'string' ? stack : undefined
        };
      }
    }
  } catch {
    // not (valid) JSON
  }
  return { kind: 'raw', text: detail };
}

function formatStack(stack: string, message: string | undefined): string {
  const lines = stack.split('\n');
  const headerMatches =
    lines.length > 0 &&
    message != null &&
    (lines[0] === message || lines[0].endsWith(`: ${message}`));
  const frames = headerMatches ? lines.slice(1) : lines;
  return frames.map((l) => l.replace(/^\s+/, '')).join('\n');
}

function ErrorNarrativeLine({ text }: { text: string }) {
  const newlineIdx = text.indexOf('\n');
  const summary = newlineIdx === -1 ? text : text.slice(0, newlineIdx);
  const rawDetail = newlineIdx === -1 ? null : text.slice(newlineIdx + 1).trim();

  if (!rawDetail) {
    return <span className="text-destructive">{summary}</span>;
  }

  const parsed = parseErrorDetail(rawDetail);

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-baseline gap-1.5 text-left text-destructive hover:opacity-80 [&[data-panel-open]_svg]:rotate-90">
        <span>{summary}</span>
        <span className="flex items-center gap-0.5">
          Details
          <IconChevronRight className="size-3 transition-transform" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {parsed.kind === 'serialized' ? (
          <div className="mt-1 flex flex-col gap-2 border border-destructive/30 bg-destructive/5 p-2 font-mono text-[11px] text-destructive">
            {(parsed.name || parsed.message) && (
              <div className="wrap-break-word whitespace-pre-wrap">
                {parsed.name && <span className="font-semibold">{parsed.name}</span>}
                {parsed.name && parsed.message && ': '}
                {parsed.message}
              </div>
            )}
            {parsed.stack && (
              <pre className="overflow-x-auto whitespace-pre-wrap text-destructive/80">
                {formatStack(parsed.stack, parsed.message)}
              </pre>
            )}
          </div>
        ) : (
          <pre className="mt-1 overflow-x-auto border border-destructive/30 bg-destructive/5 p-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">
            {parsed.text}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function StatusBadge({
  status,
  stalled
}: {
  status: ImportProgress['status'];
  stalled: boolean;
}) {
  if (stalled) {
    return <Badge variant="outline">Paused</Badge>;
  }

  switch (status) {
    case 'completed':
      return <Badge variant="default">Complete</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    case 'awaiting_selection':
    case 'awaiting_projection':
      return <Badge variant="outline">Awaiting input</Badge>;
    case 'pending':
    case 'projection':
    case 'extract':
    case 'arc':
      return <Badge variant="secondary">Running</Badge>;
    default:
      return null;
  }
}

const logLevelColor: Record<string, string> = {
  error: 'text-destructive',
  fatal: 'text-destructive',
  warn: 'text-yellow-500',
  info: 'text-muted-foreground',
  debug: 'text-muted-foreground/60',
  trace: 'text-muted-foreground/40'
};

function formatLogsForClipboard(logs: LogLine[]): string {
  return logs
    .map((line) => {
      const level = line.level.toUpperCase().padEnd(5);
      const head = `${line.timestamp} ${level} ${line.message}`;
      const meta =
        line.metadata && Object.keys(line.metadata).length > 0
          ? '\n' +
            JSON.stringify(line.metadata, null, 2)
              .split('\n')
              .map((l) => `  ${l}`)
              .join('\n')
          : '';
      return head + meta;
    })
    .join('\n');
}

function CopyLogsButton({ logs }: { logs: LogLine[] }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(formatLogsForClipboard(logs));
      setCopied(true);
    } catch (err) {
      console.error('copy logs failed', err);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={logs.length === 0}
      className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground disabled:opacity-40"
    >
      {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function StatsDialog({
  open,
  onOpenChange,
  bookImportId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookImportId: string;
}) {
  const { data, isLoading, isError } = useQuery({
    ...importUsageSummaryQueryOptions(bookImportId),
    enabled: open && !!bookImportId,
    refetchInterval: open ? 5000 : false
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-4 p-6 sm:max-w-md" initialFocus={false}>
        <DialogTitle>Pipeline stats</DialogTitle>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="text-sm text-destructive">Couldn't load stats.</p>}
        {data && <StatsBody summary={data} />}
      </DialogContent>
    </Dialog>
  );
}

function StatsBody({ summary }: { summary: ImportUsageSummary }) {
  const totalInput = summary.inputTokens + summary.cacheReadTokens;
  const cacheRate = totalInput > 0 ? summary.cacheReadTokens / totalInput : 0;
  const cacheStatus = describeCacheStatus(summary);
  const reasoningStatus = describeReasoningStatus(summary);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <Row label="LLM calls" value={summary.calls.toLocaleString()} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <Row label="Input (fresh)" value={formatTokens(summary.inputTokens)} />
        <Row label="Input (cached)" value={formatTokens(summary.cacheReadTokens)} />
        <Row label="Output" value={formatTokens(summary.outputTokens)} />
        <Row
          label="Reasoning"
          value={
            summary.reasoningTokens > 0 ? formatTokens(summary.reasoningTokens) : '—'
          }
        />
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Caching</span>
          <span className={cacheStatus.tone}>{cacheStatus.label}</span>
        </div>
        <p className="text-xs text-muted-foreground">{cacheStatus.detail(cacheRate)}</p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Reasoning</span>
          <span className={reasoningStatus.tone}>{reasoningStatus.label}</span>
        </div>
        <p className="text-xs text-muted-foreground">{reasoningStatus.detail}</p>
      </div>

      <div className="h-px bg-border" />

      <Row label="Cost so far" value={formatCost(summary.costTotal)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function describeCacheStatus(summary: ImportUsageSummary): {
  label: string;
  tone: string;
  detail: (rate: number) => string;
} {
  // Need at least a couple of calls before the cache can have warmed up.
  if (summary.calls < 2) {
    return {
      label: 'Warming up',
      tone: 'text-muted-foreground',
      detail: () => 'Cache results show after a few calls.'
    };
  }
  if (summary.callsWithCacheRead === 0) {
    return {
      label: 'No cache hits',
      tone: 'text-yellow-500',
      detail: () => 'The provider returned no cached input across any call.'
    };
  }
  return {
    label: 'Working',
    tone: 'text-primary',
    detail: (rate) =>
      `${(rate * 100).toFixed(1)}% of input tokens served from cache across ${summary.callsWithCacheRead} call${summary.callsWithCacheRead === 1 ? '' : 's'}.`
  };
}

function describeReasoningStatus(summary: ImportUsageSummary): {
  label: string;
  tone: string;
  detail: string;
} {
  if (summary.callsWithReasoning > 0) {
    return {
      label: 'Observed',
      tone: 'text-primary',
      detail: `Visible reasoning tokens captured on ${summary.callsWithReasoning} of ${summary.calls} call${summary.calls === 1 ? '' : 's'}.`
    };
  }
  return {
    label: 'Not surfaced',
    tone: 'text-muted-foreground',
    detail:
      'No visible reasoning emitted. Some providers reason internally without exposing it; this is not a sign that reasoning is off.'
  };
}

function LogPane({ logs }: { logs: LogLine[] }) {
  const reversed = useMemo(() => [...logs].reverse(), [logs]);

  return (
    <div className="size-full bg-muted/20 font-mono text-[11px] leading-relaxed">
      <Virtuoso
        style={{ height: '100%' }}
        data={reversed}
        components={{
          EmptyPlaceholder: () => (
            <span className="block px-4 py-3 text-muted-foreground/40">
              Waiting for logs…
            </span>
          ),
          Header: () => <div className="h-3" />,
          Footer: () => <div className="h-3" />
        }}
        itemContent={(_, entry) => (
          <div className="px-4">
            <LogRow entry={entry} />
          </div>
        )}
      />
    </div>
  );
}

function LogRow({ entry }: { entry: LogLine }) {
  const hasMetadata = !!entry.metadata && Object.keys(entry.metadata).length > 0;
  const row = (
    <div className="flex gap-2 text-left">
      <span className="shrink-0 text-muted-foreground/40">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <span
        className={cn(
          'shrink-0 uppercase',
          logLevelColor[entry.level] || 'text-muted-foreground'
        )}
      >
        {entry.level.slice(0, 4).padEnd(4)}
      </span>
      <span className="whitespace-pre-wrap text-foreground">
        {entry.message.replace(/^\n+/, '')}
      </span>
    </div>
  );

  if (!hasMetadata) return row;

  return (
    <Collapsible>
      <CollapsibleTrigger className="w-full cursor-pointer hover:bg-muted/40">
        {row}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 mb-2 ml-30 overflow-x-auto break-all whitespace-pre-wrap text-muted-foreground/80">
          {JSON.stringify(entry.metadata, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
