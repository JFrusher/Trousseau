'use client'

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core'
import { useAutoSave } from './hooks/useAutoSave.js'
import { useCanvasDnd } from './hooks/useCanvasDnd.js'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js'
import { WarningsProvider } from './store/warningsContext.jsx'
import AppShell from './components/layout/AppShell.jsx'
import ModalRoot from './components/layout/ModalRoot.jsx'
import ToastViewport from './components/ui/Toast.jsx'
import DragPreview from './components/canvas/DragPreview.jsx'

export default function App() {
  useAutoSave()
  useKeyboardShortcuts()

  // Touch uses a press-and-hold to start a drag so a quick swipe still scrolls
  // the guest list / pans the canvas. Mouse keeps the small distance threshold.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const { activeDrag, onDragStart, onDragEnd, onDragCancel } = useCanvasDnd()

  // When the pointer is inside multiple nested containers at once (a family
  // inside a subgroup inside a group), pointerWithin returns all of them. Sort
  // so the innermost always wins — otherwise an outer container intercepts the
  // drop and e.g. addToGroup fires instead of addToFamily.
  const nestingPriority = { family: 0, subgroup: 1, group: 2 }
  const innermostFirstCollision = (args) => {
    const hits = pointerWithin(args)
    return [...hits].sort((a, b) => {
      const ta = a.data?.droppableContainer?.data?.current?.type
      const tb = b.data?.droppableContainer?.data?.current?.type
      const pa = nestingPriority[ta] ?? 99
      const pb = nestingPriority[tb] ?? 99
      return pa - pb
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={innermostFirstCollision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <WarningsProvider>
        <AppShell />
        <DragOverlay dropAnimation={null} zIndex={9999}>
          <DragPreview drag={activeDrag} />
        </DragOverlay>
        <ModalRoot />
        <ToastViewport />
      </WarningsProvider>
    </DndContext>
  )
}
