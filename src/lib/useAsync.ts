import { useEffect, useState } from 'react'

interface State<T> { data?: T; loading: boolean; error?: string }

interface Resultado<T> { deps?: readonly unknown[]; data?: T; error?: string }

function mismasDeps(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
  return !!a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
}

/**
 * Hook genérico para cargar datos asíncronos con estados de carga/error.
 *
 * Mientras se recarga por un cambio de `deps`, CONSERVA los datos previos (`data`) con
 * `loading: true`: así las vistas que pintan con `data` no parpadean (p. ej. el mapa no
 * cae al aviso "No existe archivo por distrito" al cambiar de año). Las vistas que
 * hacen `if (loading) return <Loading/>` siguen funcionando igual.
 * El estado solo se escribe en el callback asíncrono (nunca de forma síncrona en el efecto).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): State<T> {
  const [res, setRes] = useState<Resultado<T>>({})
  useEffect(() => {
    let alive = true
    const d = deps
    fn()
      .then((data) => { if (alive) setRes({ deps: d, data }) })
      .catch((e) => { if (alive) setRes({ deps: d, error: e?.message || String(e) }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const fresco = mismasDeps(res.deps, deps)
  return {
    data: res.data,
    loading: !fresco,
    error: fresco ? res.error : undefined,
  }
}
