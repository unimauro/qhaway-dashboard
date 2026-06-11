import { useEffect, useState } from 'react'

interface State<T> { data?: T; loading: boolean; error?: string }

/** Hook genérico para cargar datos asíncronos con estados de carga/error. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): State<T> {
  const [state, setState] = useState<State<T>>({ loading: true })
  useEffect(() => {
    let alive = true
    setState({ loading: true })
    fn()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState({ loading: false, error: e?.message || String(e) }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}
