"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A list that can be reordered by dragging the handle (mouse or touch) or
 * with the keyboard (focus the handle, Space, arrow keys, Space). Calls
 * onReorder with the new id order.
 */
export function SortableList<T extends { id: string }>({
  id,
  items,
  label,
  onReorder,
  renderItem,
}: {
  /** Stable id, so server and browser render the same accessibility ids. */
  id: string;
  items: T[];
  label: string;
  onReorder: (ids: string[]) => void;
  renderItem: (item: T) => React.ReactNode;
}) {
  const [order, setOrder] = useState(items);
  const [previous, setPrevious] = useState(items);
  if (items !== previous) {
    // New data from the server replaces any local order.
    setPrevious(items);
    setOrder(items);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = order.findIndex((item) => item.id === active.id);
    const to = order.findIndex((item) => item.id === over.id);
    const next = arrayMove(order, from, to);
    setOrder(next);
    onReorder(next.map((item) => item.id));
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={order.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul aria-label={label} className="flex flex-col gap-2">
          {order.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              {renderItem(item)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-background p-2",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
