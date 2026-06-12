import { useEffect, useRef } from 'react'

/** Selector de año en forma de tira de "pills": compacto, scrollable, el año activo
 *  resaltado. Reemplaza al combo desplegable cuando hay muchos años (2004-2026). */
export default function YearStrip({
  years,
  value,
  onChange,
  label = 'Año',
}: {
  years: number[]
  value: number
  onChange: (y: number) => void
  label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Desplaza el año activo a la vista al cambiar.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('[data-active="true"]')
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [value])

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400 shrink-0">{label}</span>
      <div
        ref={ref}
        className="flex items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {years.map((y) => {
          const active = y === value
          return (
            <button
              key={y}
              type="button"
              data-active={active}
              onClick={() => onChange(y)}
              aria-pressed={active}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-sm font-semibold tabular-nums transition ${
                active
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
              }`}
            >
              {y}
            </button>
          )
        })}
      </div>
    </div>
  )
}
