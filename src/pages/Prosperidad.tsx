import { useMemo, useState } from 'react'
import { getGeoJSON, loadJSON } from '../lib/data'
import type { IndicadorDistrito } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { clasificarPiso } from '../lib/pisos'
import { num, pct } from '../lib/format'
import { Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro } from '../components/ui'
import { Chart } from '../components/Chart'
import MapaDistrital from '../components/MapaDistrital'

// ───────────────────────── Metodología del IPT ─────────────────────────
// IPT (Índice de Prosperidad Territorial) PARCIAL: solo dimensiones con dato real.
//   - desarrollo humano   → idh (0-100, directo)
//   - pobreza monetaria   → pobreza (% , invertido: a mayor pobreza, menor prosperidad)
//   - pobreza extrema     → pobrezaExt (%, invertido)
//   - vulnerab. alimentaria → vulnAlim (%, invertido)
// Cada componente se normaliza min-max al rango 0..1 sobre TODOS los distritos con dato,
// y se promedia con pesos transparentes y configurables (presets). El IPT final es 0..100.
// Es COMPARATIVO (posición relativa entre distritos), NO un diagnóstico absoluto.

type ComponenteKey = 'idh' | 'pobreza' | 'pobrezaExt' | 'vulnAlim'

interface PesoConfig {
  idh: number
  pobreza: number
  pobrezaExt: number
  vulnAlim: number
}

const PRESETS: Record<string, { label: string; pesos: PesoConfig }> = {
  equilibrado: { label: 'Equilibrado', pesos: { idh: 0.25, pobreza: 0.25, pobrezaExt: 0.25, vulnAlim: 0.25 } },
  proIdh: { label: 'Pro-IDH (desarrollo humano)', pesos: { idh: 0.55, pobreza: 0.2, pobrezaExt: 0.15, vulnAlim: 0.1 } },
  proPobreza: { label: 'Pro-pobreza (reducción de pobreza)', pesos: { idh: 0.15, pobreza: 0.35, pobrezaExt: 0.35, vulnAlim: 0.15 } },
}

const COMP_LABEL: Record<ComponenteKey, string> = {
  idh: 'IDH',
  pobreza: 'Pobreza',
  pobrezaExt: 'Pobreza ext.',
  vulnAlim: 'Vuln. alim.',
}

// Componentes que se INVIERTEN (a mayor valor, menor prosperidad)
const INVERTIDOS: ComponenteKey[] = ['pobreza', 'pobrezaExt', 'vulnAlim']

interface DistritoIPT {
  ubigeo: string
  nombre: string
  departamento: string
  iddpto: string
  ipt: number
  ind: IndicadorDistrito
  pisoColor: string
}

interface GeoNombre {
  nombre: string
  departamento: string
  iddpto: string
}

// Escala roja→verde por umbral del IPT (0..100)
function colorIPT(ipt: number): string {
  if (ipt < 30) return '#dc2626' // rojo
  if (ipt < 45) return '#f97316' // naranja
  if (ipt < 60) return '#f59e0b' // ámbar
  if (ipt < 75) return '#84cc16' // lima
  return '#16a34a' // verde
}

export default function Prosperidad() {
  const geoQ = useAsync(() => getGeoJSON(), [])
  const indQ = useAsync(() => loadJSON<IndicadorDistrito[]>('indicadores-distrito.json'), [])

  const [presetKey, setPresetKey] = useState<string>('equilibrado')
  const [verDepartamentos, setVerDepartamentos] = useState<boolean>(false)
  const [seleccionado, setSeleccionado] = useState<string | undefined>(undefined)

  const pesos = PRESETS[presetKey].pesos

  // Mapa ubigeo6 → nombre/departamento desde el geojson
  const nombres = useMemo<Map<string, GeoNombre>>(() => {
    const m = new Map<string, GeoNombre>()
    if (!geoQ.data) return m
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of (geoQ.data as any).features) {
      const p = f.properties
      m.set(p.IDDIST, { nombre: p.NOMBDIST, departamento: p.NOMBDEP, iddpto: p.IDDPTO })
    }
    return m
  }, [geoQ.data])

  // Rangos min-max por componente (sobre distritos con dato)
  const rangos = useMemo(() => {
    const r: Record<ComponenteKey, { min: number; max: number }> = {
      idh: { min: Infinity, max: -Infinity },
      pobreza: { min: Infinity, max: -Infinity },
      pobrezaExt: { min: Infinity, max: -Infinity },
      vulnAlim: { min: Infinity, max: -Infinity },
    }
    if (!indQ.data) return r
    for (const d of indQ.data) {
      for (const k of Object.keys(r) as ComponenteKey[]) {
        const v = d[k]
        if (v == null || !Number.isFinite(v)) continue
        if (v < r[k].min) r[k].min = v
        if (v > r[k].max) r[k].max = v
      }
    }
    return r
  }, [indQ.data])

  // Cálculo del IPT por distrito (depende de pesos y rangos)
  const distritos = useMemo<DistritoIPT[]>(() => {
    if (!indQ.data) return []
    const out: DistritoIPT[] = []
    for (const d of indQ.data) {
      // Normaliza cada componente disponible a 0..1 (invirtiendo los negativos)
      let acumPeso = 0
      let acumValor = 0
      for (const k of Object.keys(pesos) as ComponenteKey[]) {
        const w = pesos[k]
        if (w <= 0) continue
        const v = d[k]
        if (v == null || !Number.isFinite(v)) continue
        const { min, max } = rangos[k]
        if (!Number.isFinite(min) || max === min) continue
        let norm = (v - min) / (max - min) // 0..1
        if (INVERTIDOS.includes(k)) norm = 1 - norm
        acumValor += norm * w
        acumPeso += w
      }
      if (acumPeso === 0) continue // sin componentes válidos → se omite
      const ipt = (acumValor / acumPeso) * 100
      const geo = nombres.get(d.ubigeo)
      out.push({
        ubigeo: d.ubigeo,
        nombre: geo?.nombre ?? d.ubigeo,
        departamento: geo?.departamento ?? '—',
        iddpto: geo?.iddpto ?? d.ubigeo.slice(0, 2),
        ipt,
        ind: d,
        pisoColor: clasificarPiso(d.altitud, geo?.departamento ?? '')?.color ?? '#94a3b8',
      })
    }
    return out
  }, [indQ.data, pesos, rangos, nombres])

  // KPIs nacionales (promedio ponderado por población)
  const kpis = useMemo(() => {
    if (distritos.length === 0) return null
    let sumPob = 0
    let sumIptPob = 0
    let mejor = distritos[0]
    let peor = distritos[0]
    for (const d of distritos) {
      const pob = Number.isFinite(d.ind.pob) ? d.ind.pob : 0
      sumPob += pob
      sumIptPob += d.ipt * pob
      if (d.ipt > mejor.ipt) mejor = d
      if (d.ipt < peor.ipt) peor = d
    }
    const promPond = sumPob > 0 ? sumIptPob / sumPob : distritos.reduce((a, d) => a + d.ipt, 0) / distritos.length
    return { promPond, mejor, peor, n: distritos.length }
  }, [distritos])

  // Agregado por departamento (promedio simple del IPT)
  const departamentos = useMemo(() => {
    const m = new Map<string, { departamento: string; iddpto: string; suma: number; n: number }>()
    for (const d of distritos) {
      const cur = m.get(d.iddpto) ?? { departamento: d.departamento, iddpto: d.iddpto, suma: 0, n: 0 }
      cur.suma += d.ipt
      cur.n += 1
      m.set(d.iddpto, cur)
    }
    return Array.from(m.values())
      .map((x) => ({ departamento: x.departamento, iddpto: x.iddpto, ipt: x.suma / x.n, n: x.n }))
      .sort((a, b) => b.ipt - a.ipt)
  }, [distritos])

  // Valores para el mapa (por distrito o por departamento según toggle)
  const mapValues = useMemo(() => {
    const m = new Map<string, { value: number; label?: string; color?: string }>()
    if (verDepartamentos) {
      const porDpto = new Map<string, number>()
      for (const dep of departamentos) porDpto.set(dep.iddpto, dep.ipt)
      for (const d of distritos) {
        const v = porDpto.get(d.iddpto)
        if (v == null) continue
        m.set(d.ubigeo, { value: v, label: `${d.departamento}: ${v.toFixed(1)}`, color: colorIPT(v) })
      }
    } else {
      for (const d of distritos) {
        m.set(d.ubigeo, { value: d.ipt, label: `${d.nombre}: ${d.ipt.toFixed(1)}`, color: colorIPT(d.ipt) })
      }
    }
    return m
  }, [distritos, departamentos, verDepartamentos])

  // Rankings top/bottom 15
  const ordenados = useMemo(() => [...distritos].sort((a, b) => b.ipt - a.ipt), [distritos])
  const top15 = ordenados.slice(0, 15)
  const bottom15 = ordenados.slice(-15).reverse()

  // Distrito de la ficha
  const ficha = useMemo(
    () => distritos.find((d) => d.ubigeo === seleccionado),
    [distritos, seleccionado],
  )

  // ── Dispersión IDH vs Pobreza ──
  const scatterOption = useMemo(() => {
    const datos = distritos
      .filter((d) => d.ind.idh != null && d.ind.pobreza != null && Number.isFinite(d.ind.pob))
      .map((d) => ({
        value: [d.ind.idh, d.ind.pobreza, d.ind.pob, d.ipt],
        name: d.nombre,
        dep: d.departamento,
        itemStyle: { color: colorIPT(d.ipt), opacity: 0.6 },
      }))
    const maxPob = Math.max(1, ...datos.map((p) => p.value[2]))
    return {
      tooltip: {
        trigger: 'item',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) =>
          `<b>${p.name}</b> · ${p.data?.dep ?? ''}<br/>IDH: ${p.value[0].toFixed(1)}<br/>Pobreza: ${pct(p.value[1] / 100)}<br/>Población: ${num(p.value[2])}<br/>IPT: ${p.value[3].toFixed(1)}`,
      },
      xAxis: { name: 'IDH → mayor desarrollo', nameLocation: 'middle', nameGap: 28, type: 'value', min: 0 },
      yAxis: { name: 'Pobreza (%) →', nameLocation: 'middle', nameGap: 40, type: 'value', min: 0 },
      series: [
        {
          type: 'scatter',
          data: datos,
          symbolSize: (val: number[]) => 6 + 26 * Math.sqrt(val[2] / maxPob),
        },
      ],
    }
  }, [distritos])

  // ── Histograma de distribución del IPT (rangos de 10) ──
  const histOption = useMemo(() => {
    const bins = new Array(10).fill(0) as number[]
    for (const d of distritos) {
      const i = Math.min(9, Math.max(0, Math.floor(d.ipt / 10)))
      bins[i] += 1
    }
    const labels = bins.map((_, i) => `${i * 10}–${i * 10 + 10}`)
    const colors = bins.map((_, i) => colorIPT(i * 10 + 5))
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (ps: { name: string; value: number }[]) =>
          `IPT ${ps[0].name}<br/>${num(ps[0].value)} distritos`,
      },
      xAxis: { type: 'category', data: labels, name: 'Rango IPT' },
      yAxis: { type: 'value', name: 'N° distritos' },
      series: [
        {
          type: 'bar',
          data: bins.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
        },
      ],
    }
  }, [distritos])

  // ── Ranking de departamentos (barras) ──
  const deptoBarOption = useMemo(() => {
    const ds = [...departamentos].sort((a, b) => a.ipt - b.ipt)
    return {
      grid: { left: 110 },
      tooltip: {
        trigger: 'axis',
        formatter: (ps: { name: string; value: number }[]) =>
          `${ps[0].name}<br/>IPT promedio: ${ps[0].value.toFixed(1)}`,
      },
      xAxis: { type: 'value', name: 'IPT (0-100)', min: 0, max: 100 },
      yAxis: { type: 'category', data: ds.map((d) => d.departamento) },
      series: [
        {
          type: 'bar',
          data: ds.map((d) => ({ value: Number(d.ipt.toFixed(1)), itemStyle: { color: colorIPT(d.ipt) } })),
          label: { show: true, position: 'right', formatter: (p: { value: number }) => p.value.toFixed(1) },
        },
      ],
    }
  }, [departamentos])

  // ───────── Estados ─────────
  if (geoQ.loading || indQ.loading) return <Loading label="Cargando indicadores territoriales…" />
  if (geoQ.error) return <ErrorBox error={geoQ.error} />
  if (indQ.error) return <ErrorBox error={indQ.error} />
  if (!geoQ.data || !indQ.data) return <Loading />
  if (!kpis || distritos.length === 0)
    return <ErrorBox error="No hay distritos con indicadores suficientes para calcular el IPT." />

  const presetOptions = Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label }))

  return (
    <div className="space-y-6">
      <SectionIntro title="Índice de Prosperidad Territorial (IPT)">
        Un índice <strong>comparativo</strong> 0–100 que combina las dimensiones de prosperidad con dato
        oficial disponible por distrito. Sube si hay más desarrollo humano y baja si hay más pobreza y
        vulnerabilidad. Elige un esquema de pesos para ver cómo cambia el orden de los territorios.
      </SectionIntro>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="warn">IPT PARCIAL</Pill>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Solo dimensiones con dato real: desarrollo humano, pobreza monetaria, pobreza extrema y
          vulnerabilidad alimentaria. Educación, salud y servicios detallados están en el roadmap.
        </span>
      </div>

      {/* ── 1. Controles + KPIs ── */}
      <Card>
        <CardHeader
          title="Esquema de pesos y resumen nacional"
          subtitle="El IPT cambia según el peso que des a cada dimensión"
          help={
            <HelpTip>
              Cada componente se normaliza min–max (0 = el peor distrito del país, 1 = el mejor) y se promedia
              con los pesos del preset elegido. Pobreza, pobreza extrema y vulnerabilidad alimentaria se
              invierten (más pobreza ⇒ menos prosperidad). El IPT es <strong>relativo</strong>: mide posición
              frente a los demás distritos, no un nivel absoluto de bienestar.
            </HelpTip>
          }
          right={
            <Select
              label="Esquema de pesos"
              value={presetKey}
              onChange={(v) => setPresetKey(v)}
              options={presetOptions}
            />
          }
        />
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {(Object.keys(pesos) as ComponenteKey[]).map((k) => (
            <Pill key={k} tone={INVERTIDOS.includes(k) ? 'neutral' : 'brand'}>
              {COMP_LABEL[k]} {INVERTIDOS.includes(k) ? '↓' : '↑'}: {pct(pesos[k])}
            </Pill>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <KPI
            label="IPT nacional (ponderado por población)"
            value={kpis.promPond.toFixed(1)}
            sub={`${num(kpis.n)} distritos con dato`}
            accent
          />
          <KPI
            label="Distrito con mayor IPT"
            value={kpis.mejor.ipt.toFixed(1)}
            sub={`${kpis.mejor.nombre} · ${kpis.mejor.departamento}`}
          />
          <KPI
            label="Distrito con menor IPT"
            value={kpis.peor.ipt.toFixed(1)}
            sub={`${kpis.peor.nombre} · ${kpis.peor.departamento}`}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Metodología: normalización min–max por componente + promedio ponderado. Fuente de indicadores:
          PNUD 2019 (IDH) e INEI (pobreza, pobreza extrema, vulnerabilidad alimentaria).
          <Pill tone="warn">aprox.</Pill> Los distritos sin ningún indicador disponible se excluyen del cálculo.
        </p>
      </Card>

      {/* ── 2. Mapa ── */}
      <Card>
        <CardHeader
          title="Mapa de prosperidad territorial"
          subtitle={verDepartamentos ? 'Promedio por departamento' : 'IPT por distrito'}
          help={
            <HelpTip>
              Cada distrito se colorea por su IPT: <strong>rojo</strong> = menor prosperidad relativa,{' '}
              <strong>verde</strong> = mayor. La escala es por umbrales (rojo &lt;30, naranja, ámbar, lima,
              verde &gt;75). Toca un distrito para ver su ficha con los indicadores reales. En modo
              departamento todos los distritos de una región comparten el promedio regional.
            </HelpTip>
          }
          right={
            <Select
              label="Agregación"
              value={verDepartamentos ? 'dpto' : 'dist'}
              onChange={(v) => setVerDepartamentos(v === 'dpto')}
              options={[
                { value: 'dist', label: 'Por distrito' },
                { value: 'dpto', label: 'Por departamento' },
              ]}
            />
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <MapaDistrital
              geojson={geoQ.data}
              values={mapValues}
              unitLabel="IPT"
              formatValue={(v) => v.toFixed(1)}
              max={100}
              colorScale={(v) => colorIPT(v)}
              onSelect={(ubigeo) => setSeleccionado(ubigeo)}
              selected={seleccionado}
              height={520}
            />
          </div>
          <div>
            {ficha ? (
              <FichaDistrito d={ficha} />
            ) : (
              <div className="h-full flex items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Selecciona un distrito en el mapa para ver su ficha con indicadores reales.
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── 3. Rankings ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            title="Top 15 distritos por IPT"
            subtitle="Mayor prosperidad relativa"
            help={
              <HelpTip>
                Distritos con el IPT más alto bajo el esquema de pesos actual. Se muestran sus componentes
                reales: IDH (0-100) y los porcentajes de pobreza, pobreza extrema y vulnerabilidad
                alimentaria.
              </HelpTip>
            }
          />
          <TablaRanking filas={top15} />
        </Card>
        <Card>
          <CardHeader
            title="Bottom 15 distritos por IPT"
            subtitle="Menor prosperidad relativa"
            help={
              <HelpTip>
                Distritos con el IPT más bajo. Suelen combinar IDH bajo con alta pobreza/vulnerabilidad. El
                orden depende del esquema de pesos elegido arriba.
              </HelpTip>
            }
          />
          <TablaRanking filas={bottom15} />
        </Card>
      </div>

      {/* Ranking de departamentos */}
      <Card>
        <CardHeader
          title="Ranking de departamentos por IPT"
          subtitle="Promedio simple del IPT de sus distritos"
          help={
            <HelpTip>
              Barras = IPT promedio (no ponderado) de los distritos de cada departamento. Útil para una
              lectura macro; oculta la heterogeneidad interna (un departamento puede tener distritos muy
              dispares). <Pill tone="warn">aprox.</Pill>
            </HelpTip>
          }
        />
        <Chart option={deptoBarOption} height={Math.max(360, departamentos.length * 18)} />
      </Card>

      {/* ── 4. Dispersión IDH vs Pobreza ── */}
      <Card>
        <CardHeader
          title="IDH vs Pobreza"
          subtitle="Cada punto es un distrito"
          help={
            <HelpTip>
              Eje X = IDH (más a la derecha, más desarrollo humano). Eje Y = pobreza monetaria (más arriba,
              más pobreza). El <strong>tamaño</strong> del punto es la población y el <strong>color</strong> el
              IPT (rojo→verde). Lo esperado es una nube descendente (más IDH, menos pobreza); los puntos que
              se salen del patrón son territorios atípicos a observar.
            </HelpTip>
          }
        />
        <Chart option={scatterOption} height={460} />
      </Card>

      {/* ── 5. Distribución del IPT ── */}
      <Card>
        <CardHeader
          title="Distribución del IPT"
          subtitle="Cuántos distritos caen en cada rango"
          help={
            <HelpTip>
              Histograma: cada barra cuenta los distritos cuyo IPT cae en ese rango de 10 puntos. Una
              concentración a la izquierda indica que muchos territorios tienen baja prosperidad relativa. El
              color repite la escala roja→verde del mapa.
            </HelpTip>
          }
        />
        <Chart option={histOption} height={360} />
      </Card>
    </div>
  )
}

// ───────────────────────── Subcomponentes ─────────────────────────

function FichaDistrito({ d }: { d: DistritoIPT }) {
  const i = d.ind
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-slate-800 dark:text-slate-100">{d.nombre}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">{d.departamento}</p>
        </div>
        <span
          className="rounded-md px-2.5 py-1 text-sm font-bold text-white"
          style={{ backgroundColor: colorIPT(d.ipt) }}
        >
          IPT {d.ipt.toFixed(1)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Dato label="IDH" valor={i.idh != null ? i.idh.toFixed(1) : '—'} />
        <Dato label="Pobreza" valor={i.pobreza != null ? pct(i.pobreza / 100) : '—'} />
        <Dato label="Pobreza extrema" valor={i.pobrezaExt != null ? pct(i.pobrezaExt / 100) : '—'} />
        <Dato label="Vuln. alimentaria" valor={i.vulnAlim != null ? pct(i.vulnAlim / 100) : '—'} />
        <Dato label="Población" valor={Number.isFinite(i.pob) ? num(i.pob) : '—'} />
        <Dato label="Altitud" valor={i.altitud != null ? `${num(i.altitud)} msnm` : '—'} />
      </dl>
      <p className="text-[11px] text-slate-400">
        IDH 0–100; pobreza/pobreza ext./vuln. alim. en %. Indicadores reales (PNUD/INEI).
      </p>
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800 dark:text-slate-100">{valor}</dd>
    </div>
  )
}

function TablaRanking({ filas }: { filas: DistritoIPT[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">Distrito</th>
            <th className="py-2 pr-2 text-right">IPT</th>
            <th className="py-2 pr-2 text-right">IDH</th>
            <th className="py-2 pr-2 text-right">Pobreza</th>
            <th className="py-2 pr-2 text-right">P. ext.</th>
            <th className="py-2 pr-2 text-right">V. alim.</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((d, idx) => (
            <tr key={d.ubigeo} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-1.5 pr-2 text-slate-400">{idx + 1}</td>
              <td className="py-1.5 pr-2">
                <div className="font-medium text-slate-800 dark:text-slate-100">{d.nombre}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{d.departamento}</div>
              </td>
              <td className="py-1.5 pr-2 text-right">
                <span
                  className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: colorIPT(d.ipt) }}
                >
                  {d.ipt.toFixed(1)}
                </span>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{d.ind.idh != null ? d.ind.idh.toFixed(1) : '—'}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{d.ind.pobreza != null ? pct(d.ind.pobreza / 100) : '—'}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{d.ind.pobrezaExt != null ? pct(d.ind.pobrezaExt / 100) : '—'}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{d.ind.vulnAlim != null ? pct(d.ind.vulnAlim / 100) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
