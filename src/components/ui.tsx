import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function Card({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`rounded-2xl border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900/60 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, help, right }: { title: string; subtitle?: string; help?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-1.5">
          {title}
          {help && <HelpTip>{help}</HelpTip>}
        </h3>
        {subtitle && <p className="text-xs text-ink-400 mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

// Toggletip de ayuda accesible:
//  - área táctil de 24×24 px (WCAG 2.5.8) sin cambiar el tamaño visual del círculo «i»;
//  - aria-expanded/aria-controls; Escape y clic fuera lo cierran;
//  - hover abre una vista previa y el clic la FIJA (antes el clic tras el hover la cerraba);
//  - el globo se reubica para no salirse del viewport (horizontal y vertical).
export function HelpTip({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hover || pinned
  const id = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)

  // Escape y clic fuera: solo mientras está abierto.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setHover(false)
      setPinned(false)
      btnRef.current?.focus()
    }
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setHover(false)
        setPinned(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  // Mantener el globo dentro del viewport (ajuste directo del DOM antes de pintar).
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!open || !tip) return
    // Centrado bajo el botón con margin-left (no transform: la animación .animate-fade
    // anima `transform` y lo dejaría en `none`, descentrando el globo).
    const half = tip.offsetWidth / 2
    tip.style.marginLeft = `${-half}px`
    tip.style.top = ''
    tip.style.bottom = ''
    const M = 8
    const r = tip.getBoundingClientRect()
    let dx = 0
    if (r.left < M) dx = M - r.left
    else if (r.right > window.innerWidth - M) dx = window.innerWidth - M - r.right
    tip.style.marginLeft = `${Math.round(dx - half)}px`
    // Si no cabe debajo y sí arriba, se abre hacia arriba.
    if (r.bottom > window.innerHeight - M && r.top - r.height - 32 > 0) {
      tip.style.top = 'auto'
      tip.style.bottom = '1.5rem'
    }
  }, [open])

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label="Ayuda"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          // Si ya estaba visible por hover, el clic lo fija (no lo cierra).
          if (pinned) {
            setPinned(false)
            setHover(false)
          } else setPinned(true)
        }}
        className="group/help grid place-items-center w-6 h-6 -m-1 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <span
          aria-hidden
          className="grid place-items-center w-4 h-4 rounded-full text-[10px] font-bold bg-ink-200 dark:bg-ink-800 text-ink-600 dark:text-ink-200 group-hover/help:bg-brand-500 group-hover/help:text-white transition"
        >
          i
        </span>
      </button>
      {open && (
        <span
          ref={tipRef}
          id={id}
          role="note"
          className="absolute z-50 left-1/2 top-6 w-64 max-w-[calc(100vw-1rem)] p-3 rounded-xl text-xs leading-relaxed font-normal bg-ink-900 text-ink-50 shadow-xl border border-ink-800 animate-fade"
        >
          {children}
        </span>
      )}
    </span>
  )
}

export function KPI({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-ink-400">{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${accent ? 'text-brand-600 dark:text-brand-300' : 'text-ink-900 dark:text-ink-50'}`}>{value}</p>
      {sub && <p className="text-xs text-ink-400 mt-0.5">{sub}</p>}
    </Card>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'good' | 'brand' }) {
  const tones = {
    neutral: 'bg-ink-200 dark:bg-ink-800 text-ink-600 dark:text-ink-200',
    warn: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    good: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    brand: 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>
}

export function Select<T extends string | number>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-400">
      {label && <span>{label}</span>}
      <select
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          const opt = options.find((o) => String(o.value) === raw)
          if (opt) onChange(opt.value)
        }}
        className="rounded-lg border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-50 px-2 py-1 text-xs font-medium focus:ring-2 focus:ring-brand-500 outline-none"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

export function Loading({ label = 'Cargando datos…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20 text-ink-400 text-sm gap-2">
      <span className="w-4 h-4 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
      {label}
    </div>
  )
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="m-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-4 text-sm text-amber-800 dark:text-amber-200">
      <strong>No se pudieron cargar los datos.</strong>
      <p className="mt-1 text-xs opacity-80">
        Puede ser una conexión lenta o un pico de tráfico. Intenta de nuevo en un momento.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
      >
        ↻ Reintentar
      </button>
      {import.meta.env.DEV && <p className="mt-2 text-[10px] opacity-60">{error}</p>}
    </div>
  )
}

export function SectionIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold text-ink-900 dark:text-ink-50">{title}</h2>
      <p className="text-sm text-ink-400 mt-1 max-w-3xl">{children}</p>
    </div>
  )
}
