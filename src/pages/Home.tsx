import { Link } from 'react-router-dom'
import { getMeta, getSerieNacionalConCorte, anioEnCurso, rangoAnios } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { solesCompact, pct, fecha } from '../lib/format'
import { ejecucionValida, DEVENGADO_DESDE } from '../lib/reglas'
import SerieChart from '../components/SerieChart'
import IntroSplash from '../components/IntroSplash'
import {
  Card, CardHeader, HelpTip, KPI, Pill, Loading, ErrorBox,
} from '../components/ui'

// Marco territorial oficial (INEI): 1,845 distritos · 195 provincias · 24 departamentos + Callao.
const NUM_DISTRITOS_OFICIAL = 1845

const MODULOS = [
  {
    to: '/presupuesto',
    icon: '▦',
    titulo: 'Presupuesto Público',
    frase: 'PIM, devengado y ejecución del gasto por año, nivel de gobierno, departamento, función y distrito (SIAF-MEF).',
  },
  {
    to: '/pisos',
    icon: '⛰',
    titulo: 'Pisos Altitudinales',
    frase: 'Distritos clasificados por los 8 pisos ecológicos de Pulgar Vidal según la altitud de su capital.',
  },
  {
    to: '/clima',
    icon: '🌡',
    titulo: 'Cambio Climático',
    frase: 'Inversión ambiental/climática territorializada y su cruce con el riesgo climático por región.',
  },
  {
    to: '/riesgos',
    icon: '◬',
    titulo: 'Riesgos Territoriales',
    frase: 'Sismos, huaicos, Fenómeno del Niño, retroceso glaciar y deforestación por región y zona natural.',
  },
  {
    to: '/prosperidad',
    icon: '★',
    titulo: 'Desarrollo Humano y Densidad del Estado',
    frase: 'Tablero de indicadores citables por distrito: IDH (PNUD), pobreza y vulnerabilidad (INEI); densidad del Estado y servicios en preparación.',
  },
  {
    to: '/explorador',
    icon: '🔍',
    titulo: 'Explorador Multidimensional',
    frase: 'Cruza función/fuente × territorio × nivel de gobierno, con atribución por destino (META) y por ejecutora.',
  },
  {
    to: '/cubo',
    icon: '🧊',
    titulo: 'Cubo Presupuestal (OLAP)',
    frase: 'Pivote en vivo: cruza presupuesto × pobreza × IDH × piso × riesgo, y la tabla cruzada función × nivel/región.',
  },
  {
    to: '/historico',
    icon: '⏱',
    titulo: 'Evolución Regional',
    frase: 'Presupuesto por departamento año por año: mapa por año, ranking y serie temporal regional.',
  },
  {
    to: '/cobertura',
    icon: '🧭',
    titulo: 'Cobertura Territorial',
    frase: 'Tres estados del dato ("con dato" / "sin dato" / "no existía") y la línea de tiempo de demarcación distrital.',
  },
] as const

function KpisYGrafico() {
  const meta = useAsync(getMeta, [])
  // UNA sola fuente para KPI y gráfico: /api/serie-nacional (respaldo: serie histórica oficial).
  const serie = useAsync(getSerieNacionalConCorte, [])

  const loading = meta.loading || serie.loading
  const error = meta.error || serie.error

  if (loading) return <Loading label="Cargando indicadores nacionales…" />
  if (error) return <ErrorBox error={error} />
  if (!meta.data || !serie.data) return <Loading />

  const m = meta.data
  const serieOrdenada = [...serie.data.serie].sort((a, b) => a.year - b.year)
  const ultima = serieOrdenada[serieOrdenada.length - 1]
  const ejec = ultima ? ejecucionValida(ultima.year, ultima.devengado, ultima.pim) : null
  const nFuentes = m.sources.length
  const corte = ultima ? serie.data.corte(ultima.year) : undefined
  const enCurso = ultima != null && ultima.year === anioEnCurso(m)
  const rango = rangoAnios(serieOrdenada.map((r) => r.year))

  // Semáforo de ejecución: verde >80%, ámbar 50–80%, rojo/neutro <50% (o en curso).
  const ejecTone: 'warn' | 'good' | 'neutral' =
    ejec == null ? 'neutral' : ejec > 0.8 ? 'good' : ejec >= 0.5 ? 'warn' : 'neutral'

  return (
    <>
      <IntroSplash />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KPI
          label={`PIM nacional ${ultima?.year ?? ''}`}
          value={solesCompact(ultima?.pim)}
          sub="Presupuesto Institucional Modificado"
          accent
        />
        <KPI
          label={`Ejecución nacional ${ultima?.year ?? ''}`}
          value={pct(ejec)}
          sub={enCurso ? `Devengado / PIM · ejercicio en curso` : 'Devengado / PIM'}
        />
        <KPI
          label="Distritos"
          value={NUM_DISTRITOS_OFICIAL.toLocaleString('es-PE')}
          sub="195 provincias · 24 dptos + Callao (INEI)"
        />
        <KPI
          label="Fuentes oficiales"
          value={String(nFuentes)}
          sub="SIAF-MEF, INEI, PNUD…"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Pill tone={ejecTone}>Ejecución {pct(ejec)} en {ultima?.year ?? '—'}</Pill>
        <Pill tone="neutral">
          {corte ? `Corte ${ultima?.year}: ${fecha(corte)}` : `Actualizado: ${fecha(m.lastUpdate)}`}
        </Pill>
        {serie.data.origen === 'estatico' && <Pill tone="warn">respaldo estático (API no disponible)</Pill>}
        <Pill tone="warn">Cifras agregadas, aprox. por fecha de corte</Pill>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={`Presupuesto público — tendencia anual ${rango}`}
          subtitle="PIM y devengado por año · MEF (datos abiertos SIAF)"
          help={
            <HelpTip>
              Serie nacional del gasto público ({serieOrdenada.length} años), la misma que usan los
              indicadores de arriba y la sección Presupuesto. Las barras son el PIM y el
              devengado. {enCurso && ultima ? `${ultima.year} está en ejecución${corte ? ` (corte al ${fecha(corte)})` : ''}. ` : ''}
              El devengado solo es confiable desde {DEVENGADO_DESDE}; antes se muestra sin dato.
              No compares años sin considerar inflación (soles corrientes).
            </HelpTip>
          }
        />
        <div className="px-2 pb-3">
          <SerieChart serie={serieOrdenada} height={320} />
        </div>
      </Card>
    </>
  )
}

function SourcesBand() {
  const meta = useAsync(getMeta, [])
  if (meta.loading || meta.error || !meta.data) return null
  const m = meta.data
  return (
    <Card className="bg-ink-50/60 dark:bg-ink-900/40">
      <CardHeader
        title="Fuentes y advertencias metodológicas"
        subtitle="Datos abiertos oficiales del Estado peruano"
      />
      <div className="px-4 pb-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {m.sources.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-600 dark:text-ink-300 hover:text-brand-500 underline decoration-dotted"
            >
              {s.name} ↗
            </a>
          ))}
        </div>
        {m.notas && (
          <p className="text-xs text-ink-400 leading-relaxed border-l-2 border-amber-300 dark:border-amber-700 pl-3">
            <span className="font-semibold text-amber-600 dark:text-amber-400">Nota: </span>
            {m.notas}
          </p>
        )}
      </div>
    </Card>
  )
}

export default function Home() {
  return (
    <div className="space-y-6">
      {/* Hero compacto */}
      <section className="rounded-3xl border border-ink-200 dark:border-ink-800 bg-gradient-to-br from-brand-500/10 via-white to-sky-500/5 dark:from-brand-500/15 dark:via-ink-900 dark:to-sky-900/10 p-6 md:p-8">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="brand">FIEECS-UNI</Pill>
            <Pill tone="neutral">Datos abiertos · SIAF-MEF</Pill>
          </div>
          <a href="https://fieecs.uni.edu.pe" target="_blank" rel="noreferrer" className="shrink-0" aria-label="Facultad de Ingeniería Económica, Estadística y Ciencias Sociales — UNI">
            <img src={`${import.meta.env.BASE_URL}fieecs-color.png`} alt="FIEECS — UNI" className="h-12 md:h-16 w-auto block dark:hidden" />
            <img src={`${import.meta.env.BASE_URL}fieecs-blanco.png`} alt="FIEECS — UNI" className="h-12 md:h-16 w-auto hidden dark:block" />
          </a>
        </div>
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-ink-900 dark:text-ink-50">
          QHAWAY <span className="text-brand-500">2.0</span>
        </h1>
        <p className="mt-3 max-w-3xl text-sm md:text-base text-ink-600 dark:text-ink-300 leading-relaxed">
          Observatorio Nacional de Inteligencia Territorial, Presupuesto Público,
          Cambio Climático, Riesgos y Desarrollo Humano. Una mirada distrital del
          Perú a partir de fuentes oficiales.
        </p>

        <div className="mt-6">
          <KpisYGrafico />
        </div>
      </section>

      {/* Tarjetas de navegación a los 4 módulos */}
      <section>
        <h2 className="text-xl font-bold text-ink-900 dark:text-ink-50 mb-1">Explora los módulos</h2>
        <p className="text-sm text-ink-400 mb-4 max-w-3xl">
          Lentes complementarios sobre el mismo territorio: cómo se asigna el gasto, cómo se
          distribuye la geografía, cuánto se invierte en clima, qué riesgos enfrenta y cómo
          prospera su gente.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {MODULOS.map((mod) => (
            <Link
              key={mod.to}
              to={mod.to}
              className="group block rounded-2xl border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900/60 p-5 shadow-sm hover:shadow-md hover:border-brand-400 dark:hover:border-brand-600 transition"
            >
              <span className="grid place-items-center w-11 h-11 rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300 text-xl mb-3 group-hover:scale-105 transition-transform">
                {mod.icon}
              </span>
              <h3 className="text-base font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-1">
                {mod.titulo}
                <span className="text-brand-500 opacity-0 group-hover:opacity-100 transition">→</span>
              </h3>
              <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400 leading-relaxed">{mod.frase}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Cómo leer este observatorio */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Cómo leer este observatorio" subtitle="Buenas prácticas para interpretar las cifras" />
          <ul className="px-4 pb-4 space-y-2.5 text-sm text-ink-600 dark:text-ink-300">
            <li className="flex gap-2">
              <span className="text-brand-500 mt-0.5">●</span>
              <span>
                <strong>PIM vs. devengado.</strong> El PIM es el presupuesto que se podía
                gastar; el devengado es el gasto efectivamente realizado. La
                <em> ejecución</em> es su cociente (devengado ÷ PIM).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-brand-500 mt-0.5">●</span>
              <span>
                <strong>Semáforo de ejecución.</strong> Usamos rojo (&lt;50%), ámbar
                (50–80%) y verde (&gt;80%) para señalar qué tan completo fue el gasto.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-brand-500 mt-0.5">●</span>
              <span>
                <strong>Dato real vs. estimación.</strong> Lo que es aproximación o
                supuesto metodológico va marcado con <Pill tone="warn">aprox.</Pill>
                (p. ej. el piso altitudinal asignado por la altitud de la capital
                distrital o los indicadores aún en preparación).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-brand-500 mt-0.5">●</span>
              <span>
                <strong>Fechas de corte.</strong> Las cifras del SIAF pueden diferir de
                Consulta Amigable según la fecha de extracción y el nivel de agregación.
              </span>
            </li>
          </ul>
          <div className="px-4 pb-4">
            <Link to="/metodologia" className="text-sm font-medium text-brand-600 dark:text-brand-300 hover:underline">
              Ver metodología completa y preguntas frecuentes →
            </Link>
          </div>
        </Card>

        <SourcesBand />
      </section>
    </div>
  )
}
