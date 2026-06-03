import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconChevronRight } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  entitySelectionQueryOptions,
  type EntitySelectionType,
  type SelectionEntity
} from '@/hooks/queries/entity-selection';
import { recheckMinor } from '@/lib/pipeline';
import { updateSelectionEntities } from '@/lib/selection-entities';
import { cn } from '@/lib/utils';

type Tier = 'PRIMARY' | 'SECONDARY';
type ContainerId = 'PRIMARY' | 'OTHER';

interface PartitionedState {
  PRIMARY: SelectionEntity[];
  OTHER: SelectionEntity[];
}

function isMinor(entity: SelectionEntity) {
  return entity.minorStatus === 'THROUGHOUT';
}

interface EntitySelectionPaneProps {
  bookImportId: string;
  bookId: string;
  entityType: EntitySelectionType;
  primaryHeading: string;
  otherHeading: string;
  locked: boolean;
  onContinue?: () => void;
  onChanged?: () => void;
  continueLabel?: string;
}

function byRank(a: SelectionEntity, b: SelectionEntity) {
  const ar = a.significanceRank ?? Number.MAX_SAFE_INTEGER;
  const br = b.significanceRank ?? Number.MAX_SAFE_INTEGER;
  if (ar !== br) return ar - br;
  return a.name.localeCompare(b.name);
}

function partition(entities: SelectionEntity[]): PartitionedState {
  const draggable = entities.filter((e) => !isMinor(e));
  return {
    PRIMARY: draggable
      .filter((e) => e.significanceTier === 'PRIMARY')
      .slice()
      .sort(byRank),
    OTHER: draggable
      .filter((e) => e.significanceTier !== 'PRIMARY')
      .slice()
      .sort(byRank)
  };
}

function findContainer(state: PartitionedState, id: string): ContainerId | null {
  if (id === 'PRIMARY' || id === 'OTHER') return id;
  if (state.PRIMARY.some((e) => e.id === id)) return 'PRIMARY';
  if (state.OTHER.some((e) => e.id === id)) return 'OTHER';
  return null;
}

interface PersistedChange {
  id: string;
  significanceTier: Tier;
  significanceRank: number;
}

function diffChanges(prev: SelectionEntity[], next: PartitionedState): PersistedChange[] {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const changes: PersistedChange[] = [];
  const handle = (items: SelectionEntity[], container: ContainerId) => {
    const tier: Tier = container === 'PRIMARY' ? 'PRIMARY' : 'SECONDARY';
    items.forEach((entity, index) => {
      const previous = prevById.get(entity.id);
      const rank = index + 1;
      const prevContainer: ContainerId =
        previous?.significanceTier === 'PRIMARY' ? 'PRIMARY' : 'OTHER';
      if (
        !previous ||
        prevContainer !== container ||
        previous.significanceRank !== rank
      ) {
        changes.push({ id: entity.id, significanceTier: tier, significanceRank: rank });
      }
    });
  };
  handle(next.PRIMARY, 'PRIMARY');
  handle(next.OTHER, 'OTHER');
  return changes;
}

function applyChanges(
  prev: SelectionEntity[],
  next: PartitionedState,
  changes: PersistedChange[]
): SelectionEntity[] {
  const changeMap = new Map(changes.map((c) => [c.id, c]));
  const apply = (e: SelectionEntity) => {
    const c = changeMap.get(e.id);
    return c
      ? {
          ...e,
          significanceTier: c.significanceTier,
          significanceRank: c.significanceRank
        }
      : e;
  };
  return [...next.PRIMARY.map(apply), ...next.OTHER.map(apply), ...prev.filter(isMinor)];
}

export function EntitySelectionPane({
  bookImportId,
  bookId,
  entityType,
  primaryHeading,
  otherHeading,
  locked,
  onContinue,
  onChanged,
  continueLabel
}: EntitySelectionPaneProps) {
  const queryClient = useQueryClient();
  const queryOptions = entitySelectionQueryOptions(bookImportId, bookId, entityType);
  const { data: entities } = useQuery(queryOptions);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<PartitionedState | null>(null);

  const items = useMemo<PartitionedState>(
    () => dragState ?? (entities ? partition(entities) : { PRIMARY: [], OTHER: [] }),
    [dragState, entities]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const persist = useMutation({
    mutationFn: (changes: PersistedChange[]) =>
      updateSelectionEntities(bookImportId, changes),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
    }
  });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setDragState(items);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (locked) return;
    const { active, over } = event;
    if (!over) return;
    const activeContainer = findContainer(items, String(active.id));
    const overContainer = findContainer(items, String(over.id));
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    setDragState((prev) => {
      const base = prev ?? items;
      const fromList = base[activeContainer];
      const toList = base[overContainer];
      const activeIndex = fromList.findIndex((e) => e.id === active.id);
      if (activeIndex === -1) return prev;
      const overIndex =
        over.id === overContainer
          ? toList.length
          : toList.findIndex((e) => e.id === over.id);
      const insertIndex = overIndex === -1 ? toList.length : overIndex;
      const moved = fromList[activeIndex];
      return {
        ...base,
        [activeContainer]: fromList.filter((e) => e.id !== active.id),
        [overContainer]: [
          ...toList.slice(0, insertIndex),
          moved,
          ...toList.slice(insertIndex)
        ]
      };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (locked || !over) {
      setDragState(null);
      return;
    }
    const activeContainer = findContainer(items, String(active.id));
    const overContainer = findContainer(items, String(over.id));
    if (!activeContainer || !overContainer) {
      setDragState(null);
      return;
    }
    let next = items;
    if (activeContainer === overContainer) {
      const list = items[activeContainer];
      const oldIndex = list.findIndex((e) => e.id === active.id);
      const newIndex =
        over.id === overContainer
          ? list.length - 1
          : list.findIndex((e) => e.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        next = { ...items, [activeContainer]: arrayMove(list, oldIndex, newIndex) };
      }
    }
    const changes = diffChanges(entities ?? [], next);
    queryClient.setQueryData<SelectionEntity[]>(
      queryOptions.queryKey,
      applyChanges(entities ?? [], next, changes)
    );
    setDragState(null);
    if (changes.length > 0) {
      persist.mutate(changes);
      onChanged?.();
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setDragState(null);
  };

  const activeEntity = useMemo(() => {
    if (!activeId) return null;
    return [...items.PRIMARY, ...items.OTHER].find((e) => e.id === activeId) ?? null;
  }, [activeId, items]);

  const minors = useMemo(
    () => (entities ?? []).filter(isMinor).slice().sort(byRank),
    [entities]
  );

  return (
    <div className="flex size-full flex-col gap-3">
      <p className="text-center font-serif text-xs text-muted-foreground italic">
        Drag-and-drop to select your primary{' '}
        {entityType === 'CHARACTER' ? 'characters' : 'locations'}.
        <br /> We'll gather extra details about them to ensure a rich gameplay experience.
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Zone
            id="PRIMARY"
            heading={primaryHeading}
            items={items.PRIMARY}
            locked={locked}
            activeId={activeId}
          />
          <Divider heading={otherHeading} count={items.OTHER.length} />
          <Zone
            id="OTHER"
            heading={null}
            items={items.OTHER}
            locked={locked}
            activeId={activeId}
          />
          {minors.length > 0 && (
            <MinorsZone
              items={minors}
              bookImportId={bookImportId}
              bookId={bookId}
              queryKey={queryOptions.queryKey}
            />
          )}
        </div>
        <DragOverlay>
          {activeEntity ? <RowGhost entity={activeEntity} /> : null}
        </DragOverlay>
      </DndContext>
      {!locked && onContinue && (
        <button
          type="button"
          disabled={items.PRIMARY.length === 0}
          className="self-center bg-primary px-5 py-2 font-serif text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
          onClick={onContinue}
        >
          {continueLabel ?? 'Continue'}
        </button>
      )}
    </div>
  );
}

function Zone({
  id,
  heading,
  items,
  locked,
  activeId
}: {
  id: ContainerId;
  heading: string | null;
  items: SelectionEntity[];
  locked: boolean;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col transition-colors',
        isOver && items.length === 0 && 'bg-primary/5'
      )}
    >
      {heading != null && (
        <h3 className="px-3 py-2 text-center font-serif text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          {heading}
          <span className="ml-2 tabular-nums opacity-60">{items.length}</span>
        </h3>
      )}
      <SortableContext
        items={items.map((e) => e.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="min-h-10 px-1 py-1">
          {items.length === 0 ? (
            <p className="px-2 py-3 text-center font-serif text-xs text-muted-foreground/60 italic">
              (none)
            </p>
          ) : (
            items.map((entity) => (
              <SortableRow
                key={entity.id}
                entity={entity}
                locked={locked}
                isDragging={activeId === entity.id}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function MinorsZone({
  items,
  bookImportId,
  bookId,
  queryKey
}: {
  items: SelectionEntity[];
  bookImportId: string;
  bookId: string;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const recheck = useMutation({
    mutationFn: (id: string) => recheckMinor(bookImportId, bookId, id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    }
  });
  return (
    <div className="flex flex-col opacity-50">
      <Divider heading="Minors" count={items.length} />
      <p className="text-center font-serif text-xs text-muted-foreground italic">
        For safety, we don't allow characters who are under 18 throughout the book to be
        selected.
      </p>
      <div className="px-1 py-1">
        {items.map((entity) => (
          <div key={entity.id} className="flex items-center gap-1">
            <div className="min-w-0 flex-1 cursor-not-allowed">
              <RowContent entity={entity} locked={true} />
            </div>
            <button
              type="button"
              disabled={recheck.isPending}
              onClick={() => recheck.mutate(entity.id)}
              className="shrink-0 px-1.5 py-1 font-serif text-[10px] tracking-[0.15em] text-muted-foreground uppercase hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recheck.isPending && recheck.variables === entity.id
                ? 'Rechecking…'
                : 'Recheck'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Divider({ heading, count }: { heading: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 px-3 py-2">
      <div className="h-px flex-1 bg-border/60" />
      <span className="font-serif text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
        {heading}
        <span className="ml-2 tabular-nums opacity-60">{count}</span>
      </span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function SortableRow({
  entity,
  locked,
  isDragging
}: {
  entity: SelectionEntity;
  locked: boolean;
  isDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: entity.id,
    disabled: locked
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && 'opacity-30')}
      {...attributes}
      {...listeners}
    >
      <RowContent entity={entity} locked={locked} />
    </div>
  );
}

function RowContent({ entity, locked }: { entity: SelectionEntity; locked: boolean }) {
  const hasDescription = !!entity.description;
  return (
    <Collapsible
      className={cn(
        'flex flex-col rounded-sm px-1.5 py-1 font-serif text-sm',
        !locked && 'cursor-grab active:cursor-grabbing'
      )}
    >
      <div className="flex w-full items-center gap-1.5">
        {hasDescription ? (
          <CollapsibleTrigger
            onPointerDown={(e) => e.stopPropagation()}
            className="shrink-0 text-muted-foreground hover:text-foreground [&[data-panel-open]_svg]:rotate-90"
            aria-label="Toggle description"
          >
            <IconChevronRight className="size-3 transition-transform" />
          </CollapsibleTrigger>
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <span className="truncate">{entity.name}</span>
        {entity.label && entity.label !== entity.name && (
          <span className="truncate text-xs text-muted-foreground/70 italic">
            {entity.label}
          </span>
        )}
      </div>
      {entity.description && (
        <CollapsibleContent>
          <p className="mt-1 pr-2 pl-4 text-xs leading-relaxed text-muted-foreground italic">
            {entity.description}
          </p>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function RowGhost({ entity }: { entity: SelectionEntity }) {
  return (
    <div className="flex items-center gap-1.5 rounded-sm bg-card px-1.5 py-1 font-serif text-sm shadow-md ring-1 ring-border">
      <span className="size-3 shrink-0" />
      <span className="truncate">{entity.name}</span>
      {entity.label && entity.label !== entity.name && (
        <span className="truncate text-xs text-muted-foreground/70 italic">
          {entity.label}
        </span>
      )}
    </div>
  );
}
