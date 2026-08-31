import { createContext, useContext, useMemo } from 'react'
import { useStore } from './useStore.js'
import { computeWarnings, buildWarningIndex } from '../utils/warnings.js'

const EMPTY = []
const WarningsContext = createContext({ list: EMPTY, byTable: new Map(), byGuest: new Map() })

export function WarningsProvider({ children }) {
  const guests = useStore((s) => s.guests)
  const tables = useStore((s) => s.tables)
  const constraints = useStore((s) => s.constraints)
  const families = useStore((s) => s.families)

  const value = useMemo(() => {
    const list = computeWarnings({ guests, tables, constraints, families })
    return { list, ...buildWarningIndex(list) }
  }, [guests, tables, constraints, families])

  return <WarningsContext.Provider value={value}>{children}</WarningsContext.Provider>
}

export const useWarnings = () => useContext(WarningsContext)
export const useTableWarnings = (id) => useContext(WarningsContext).byTable.get(id) || EMPTY
export const useGuestWarnings = (id) => useContext(WarningsContext).byGuest.get(id) || EMPTY
