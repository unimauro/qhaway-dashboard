import { useMemo, useState } from 'react'
import { loadJSON, getGeoJSON } from '../lib/data'
import type { RiesgosData } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import {
  Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro,
} from '../components/ui'
import { Chart } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'
import { num } from '../lib/format'

type Nivel = 'alta' | 'media' | 'baja'

const NIVEL_COLOR: Record<Nivel, string> = {
  alta: '#ef4444',
  media: '#f59e0b',
  baja: '#22c55e',
}
const SIN_DATO = '#94a3b8'
const NIVEL_VALOR: Record<Nivel, number> = { alta: 3, media: 2, baja: 1 }
const NIVEL_LABEL: Record<Nivel, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' }

export default function Riesgos() {
  const { data, loading, error } = useAsync<[RiesgosData, any]>(
    () => Promise.all([loadJSON<RiesgosData>('riesgos.json'), getGeoJSON()]),
    [],
  )
  const [riesgo, setRiesgo] = useState<string>('sismo')

  const riesgoData = data?.[0]
  const geo = data?.[1]

  // Opciones del Select: solo riesgos presentes en alguna región (con su etiqueta)
  const opciones = useMemo(() => {
    if (!riesgoData) return []
    const usados = new Set<string>()
    riesgoData.regions.forEach((r) => Object.keys(r.risks).forEach((k) => usados.add(k)))
    return Object.entries(riesgoData.riskLabels)
      .filter(([k]) => usados.has(k))
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'))
  }, [riesgoData])

  // ubigeo(2díg) -> nivel del riesgo seleccionado
  const nivelPorUbigeo = useMemo(() => {
    const m = new Map<string, Nivel | undefined>()
    if (!riesgoData) return m
    riesgoData.regions.forEach((r) => {
      const n = r.risks[riesgo] as Nivel | undefined
      m.set(r.ubigeo, n)
    })
    return m
  }, [riesgoData, riesgo])

  // Valores del mapa: cada distrito hereda el nivel de SU departamento (IDDPTO 2díg)
  const mapValues = useMemo(() => {
    const m = new Map<string, MapValue>()
    if (!geo?.features) return m
    for (const f of geo.features) {
      const idDist = f?.properties?.IDDIST as string | undefined
      const idDpto = f?.properties?.IDDPTO as string | undefined
      if (!idDist || !idDpto) continue
      const nivel = nivelPorUbigeo.get(idDpto)
      m.set(idDist, {
        value: nivel ? NIVEL_VALOR[nivel] : 0,
        color: nivel ? NIVEL_COLOR[nivel] : SIN_DATO,
        label: nivel ? `Riesgo ${NIVEL_LABEL[nivel].toLowerCase()} (nivel departamental)` : 'Sin clasificación',
      })
    }
    return m
  }, [geo, nivelPorUbigeo])

  // Conteo de regiones por nivel para el riesgo seleccionado
  const conteo = useMemo(() => {
    const c: Record<Nivel, number> = { alta: 0, media: 0, baja: 0 }
    if (!riesgoData) return c
    riesgoData.regions.forEach((r) => {
      const n = r.risks[riesgo] as Nivel | undefined
      if (n) c[n] += 1
    })
    return c
  }, [riesgoData, riesgo])

  if (loading) return <Loading label="Cargando riesgos territoriales…" />
  if (error) return <ErrorBox error={error} />
  if (!riesgoData || !geo) return <Loading />

  const etiquetaRiesgo = riesgoData.riskLabels[riesgo] ?? riesgo

  // ----- Matriz región × riesgo (heatmap) -----
  const tiposMatriz = opciones.map((o) => o.value)
  const regionesMatriz = [...riesgoData.regions]
  const heatData: [number, number, number][] = []
  regionesMatriz.forEach((r, ry) => {
    tiposMatriz.forEach((t, tx) => {
      const n = r.risks[t] as Nivel | undefined
      if (n) heatData.push([tx, ry, NIVEL_VALOR[n]])
    })
  })

  const heatmapOption = {
    grid: { left: 110, right: 16, top: 8, bottom: 90 },
    tooltip: {
      formatter: (p: any) => {
        const t = tiposMatriz[p.value[0]]
        const r = regionesMatriz[p.value[1]]
        const lbl = (['', 'baja', 'media', 'alta'] as const)[p.value[2]] ?? '—'
        return `<b>${r.name}</b><br>${riesgoData.riskLabels[t] ?? t}<br>Nivel: ${lbl}`
      },
    },
    xAxis: {
      type: 'category',
      data: tiposMatriz.map((t) => riesgoData.riskLabels[t] ?? t),
      axisLabel: { rotate: 55, fontSize: 10, interval: 0 },
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category',
      data: regionesMatriz.map((r) => r.name),
      axisLabel: { fontSize: 10 },
      splitArea: { show: true },
    },
    visualMap: {
      type: 'piecewise',
      min: 1, max: 3,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      pieces: [
        { value: 1, label: 'Baja', color: NIVEL_COLOR.baja },
        { value: 2, label: 'Media', color: NIVEL_COLOR.media },
        { value: 3, label: 'Alta', color: NIVEL_COLOR.alta },
      ],
    },
    series: [{
      type: 'heatmap',
      data: heatData,
      label: { show: false },
      itemStyle: { borderColor: 'rgba(148,163,184,.25)', borderWidth: 1 },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,.3)' } },
    }],
  }

  // ----- Población expuesta (regiones con nivel 'alta' en el riesgo) -----
  const expuestas = riesgoData.regions
    .filter((r) => (r.risks[riesgo] as Nivel | undefined) === 'alta')
    .sort((a, b) => b.pob - a.pob)
  const pobTotalAlta = expuestas.reduce((s, r) => s + r.pob, 0)

  const pobExpOption = {
    grid: { left: 90, right: 24, top: 8, bottom: 28 },
    tooltip: { trigger: 'axis', formatter: (p: any) => `<b>${p[0].name}</b><br>Población: ${num(p[0].value)}` },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 1e6).toFixed(1)} M` } },
    yAxis: { type: 'category', data: expuestas.map((r) => r.name).reverse(), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: expuestas.map((r) => r.pob).reverse(),
      itemStyle: { color: NIVEL_COLOR.alta, borderRadius: [0, 4, 4, 0] },
      barMaxWidth: 22,
    }],
  }

  // ----- Contexto histórico -----
  const sismos = riesgoData.context.sismosHistoricos
  const nino = riesgoData.context.ninoEventos
  const glaciares = riesgoData.context.glaciaresKm2
  const defo = [...riesgoData.context.deforestacion2023].sort((a, b) => b.ha - a.ha)
  const damn = riesgoData.context.damnificadosPorAnio

  const glaciarOption = {
    grid: { left: 56, right: 24, top: 12, bottom: 28 },
    tooltip: { trigger: 'axis', formatter: (p: any) => `Año ${p[0].name}<br>${num(p[0].value)} km²` },
    xAxis: { type: 'category', data: glaciares.labels.map((l) => String(l)), boundaryGap: false },
    yAxis: { type: 'value', name: 'km²', axisLabel: { formatter: (v: number) => num(v) } },
    series: [{
      type: 'line', data: glaciares.km2, smooth: true, areaStyle: { opacity: 0.18 },
      lineStyle: { width: 3, color: '#0ea5e9' }, itemStyle: { color: '#0ea5e9' },
    }],
  }

  const defoOption = {
    grid: { left: 100, right: 24, top: 8, bottom: 28 },
    tooltip: { trigger: 'axis', formatter: (p: any) => `<b>${p[0].name}</b><br>${num(p[0].value)} ha` },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 1000).toFixed(0)} k` } },
    yAxis: { type: 'category', data: defo.map((d) => d.region).reverse(), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar', data: defo.map((d) => d.ha).reverse(),
      itemStyle: { color: '#16a34a', borderRadius: [0, 4, 4, 0] }, barMaxWidth: 22,
    }],
  }

  const damnOption = {
    grid: { left: 64, right: 24, top: 12, bottom: 28 },
    tooltip: { trigger: 'axis', formatter: (p: any) => `Año ${p[0].name}<br>${num(p[0].value)} damnificados` },
    xAxis: { type: 'category', data: damn.map((d) => String(d.anio)) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 1000).toFixed(0)} k` } },
    series: [{
      type: 'bar', data: damn.map((d) => d.cifra),
      itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 36,
    }],
  }

  return (
    <div className="space-y-6">
      <SectionIntro title="Riesgos territoriales del Perú">
        Exposición a peligros naturales y socioambientales por región. Selecciona un tipo de
        riesgo para ver qué departamentos están más expuestos, la matriz comparativa de las 25
        regiones y el contexto histórico (sismos, El Niño, retroceso glaciar, deforestación y
        damnificados). Fuentes oficiales: IGP, SENAMHI, ENFEN, CENEPRED, INDECI, INAIGEM y MINAM.
      </SectionIntro>

      {/* Controles + KPIs */}
      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <Select
            label="Tipo de riesgo"
            value={riesgo}
            onChange={setRiesgo}
            options={opciones}
          />
          <div className="grid grid-cols-3 gap-3">
            <KPI label="Regiones nivel alto" value={num(conteo.alta)} sub={etiquetaRiesgo} accent />
            <KPI label="Nivel medio" value={num(conteo.media)} />
            <KPI label="Nivel bajo" value={num(conteo.baja)} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Pill tone="warn">aprox.</Pill>
          <span className="text-ink-600 dark:text-ink-300">
            La clasificación de riesgo es a nivel DEPARTAMENTAL (25 regiones), no distrital. Todos
            los distritos de un mismo departamento comparten el nivel mostrado.
          </span>
        </div>
      </Card>

      {/* 1. MAPA por riesgo */}
      <Card>
        <CardHeader
          title={`Mapa de exposición — ${etiquetaRiesgo}`}
          subtitle="Cada distrito se colorea con el nivel de riesgo de su departamento"
          help={
            <HelpTip>
              Cada distrito se pinta con el nivel de riesgo de su departamento:{' '}
              <b style={{ color: NIVEL_COLOR.alta }}>rojo = alta</b>,{' '}
              <b style={{ color: NIVEL_COLOR.media }}>ámbar = media</b>,{' '}
              <b style={{ color: NIVEL_COLOR.baja }}>verde = baja</b>, gris = sin dato. NO interpretes
              variación dentro de un departamento: la información es regional (25 regiones), no
              distrital. Pasa el cursor o haz clic en un distrito para ver el detalle.
            </HelpTip>
          }
          right={<Pill tone="warn">nivel departamental</Pill>}
        />
        <MapaDistrital
          geojson={geo}
          values={mapValues}
          unitLabel="Riesgo"
          formatValue={(v) => (['Sin dato', 'Baja', 'Media', 'Alta'] as const)[v] ?? '—'}
          max={3}
          height={520}
        />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-600 dark:text-ink-300">
          <Leyenda color={NIVEL_COLOR.alta} t="Alta" />
          <Leyenda color={NIVEL_COLOR.media} t="Media" />
          <Leyenda color={NIVEL_COLOR.baja} t="Baja" />
          <Leyenda color={SIN_DATO} t="Sin dato" />
        </div>
      </Card>

      {/* 2. Matriz región × riesgo */}
      <Card>
        <CardHeader
          title="Matriz de riesgos: regiones × peligros"
          subtitle="25 regiones (filas) frente a cada tipo de peligro (columnas)"
          help={
            <HelpTip>
              Cada celda muestra el nivel de exposición de una región (fila) a un peligro (columna):{' '}
              <b style={{ color: NIVEL_COLOR.baja }}>verde = baja</b>,{' '}
              <b style={{ color: NIVEL_COLOR.media }}>ámbar = media</b>,{' '}
              <b style={{ color: NIVEL_COLOR.alta }}>rojo = alta</b>. Las celdas en blanco indican que
              ese peligro no está clasificado para esa región. Lee por fila para el perfil de riesgo
              de una región; lee por columna para ver qué regiones comparten un mismo peligro.
            </HelpTip>
          }
        />
        <Chart option={heatmapOption} height={Math.max(420, regionesMatriz.length * 22 + 130)} />
      </Card>

      {/* 3. Población expuesta */}
      <Card>
        <CardHeader
          title={`Población expuesta a riesgo alto — ${etiquetaRiesgo}`}
          subtitle={
            expuestas.length
              ? `${num(expuestas.length)} regiones · ${(pobTotalAlta / 1e6).toFixed(1)} M de habitantes`
              : 'Ninguna región con nivel alto para este riesgo'
          }
          help={
            <HelpTip>
              Barras con la población (estimada) de las regiones clasificadas con riesgo{' '}
              <b style={{ color: NIVEL_COLOR.alta }}>alto</b> para el peligro seleccionado, ordenadas
              de mayor a menor. Es población TOTAL de la región, no la directamente afectable: el
              riesgo es departamental, así que esta cifra aproxima la exposición potencial.
            </HelpTip>
          }
          right={<Pill tone="warn">población total regional</Pill>}
        />
        {expuestas.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-500 dark:text-ink-400">
            No hay regiones con nivel alto para «{etiquetaRiesgo}».
          </p>
        ) : (
          <Chart option={pobExpOption} height={Math.max(220, expuestas.length * 34 + 60)} />
        )}
      </Card>

      {/* 4. Contexto histórico */}
      <h2 className="pt-2 text-lg font-semibold text-ink-800 dark:text-ink-100">
        Contexto histórico y tendencias
      </h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Sismos históricos (tabla) */}
        <Card>
          <CardHeader
            title="Sismos históricos del Perú"
            subtitle="Eventos mayores registrados"
            help={
              <HelpTip>
                Tabla de terremotos históricos relevantes: año, zona afectada, magnitud (Mw) y número
                aproximado de fallecidos. Las cifras de víctimas de eventos antiguos son estimaciones
                históricas. Ordenada de más reciente a más antiguo.
              </HelpTip>
            }
            right={<Pill tone="warn">muertos aprox.</Pill>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-500 dark:text-ink-400">
                  <th className="py-1 pr-3 font-medium">Año</th>
                  <th className="py-1 pr-3 font-medium">Evento</th>
                  <th className="py-1 pr-3 text-right font-medium">Mag.</th>
                  <th className="py-1 text-right font-medium">Muertos</th>
                </tr>
              </thead>
              <tbody>
                {[...sismos].sort((a, b) => b.anio - a.anio).map((s, i) => (
                  <tr key={i} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="py-1.5 pr-3 tabular-nums">{s.anio}</td>
                    <td className="py-1.5 pr-3">{s.nombre}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.mag.toFixed(1)}</td>
                    <td className="py-1.5 text-right tabular-nums">{num(s.muertos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Timeline El Niño */}
        <Card>
          <CardHeader
            title="Eventos El Niño"
            subtitle="Cronología por intensidad"
            help={
              <HelpTip>
                Línea de tiempo de los eventos de El Niño y su intensidad clasificada (de débil a
                extraordinario). Útil para ver la recurrencia; no implica periodicidad regular, los
                eventos no siguen un ciclo fijo.
              </HelpTip>
            }
          />
          <ol className="relative space-y-3 border-l border-ink-200 pl-4 dark:border-ink-700">
            {nino.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-amber-500" />
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums text-ink-800 dark:text-ink-100">{e.anio}</span>
                  <Pill tone={/extraordinario/i.test(e.intensidad) ? 'warn' : 'neutral'}>{e.intensidad}</Pill>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        {/* Retroceso glaciar */}
        <Card>
          <CardHeader
            title="Retroceso glaciar (superficie en km²)"
            subtitle="Pérdida de glaciares tropicales peruanos"
            help={
              <HelpTip>
                Línea con la superficie glaciar total estimada (km²) en distintos años. La pendiente
                descendente indica pérdida acelerada de glaciares por el cambio climático, lo que
                afecta la disponibilidad de agua. Pasa el cursor para ver el valor de cada año.
              </HelpTip>
            }
            right={<Pill tone="warn">estimación INAIGEM</Pill>}
          />
          <Chart option={glaciarOption} height={260} />
        </Card>

        {/* Deforestación 2023 */}
        <Card>
          <CardHeader
            title="Deforestación 2023 por región (ha)"
            subtitle="Pérdida de bosque húmedo amazónico"
            help={
              <HelpTip>
                Barras con las hectáreas (ha) de bosque perdidas en 2023 por región, ordenadas de
                mayor a menor. Concentra la pérdida en la Amazonía. Fuente: MINAM Geobosques. El eje
                está en miles de hectáreas (k).
              </HelpTip>
            }
          />
          <Chart option={defoOption} height={Math.max(220, defo.length * 30 + 60)} />
        </Card>

        {/* Damnificados por año */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Damnificados por emergencias (por año)"
            subtitle="Personas afectadas registradas por INDECI"
            help={
              <HelpTip>
                Barras con el número de damnificados por desastres registrados cada año. Los picos
                suelen coincidir con eventos El Niño u otros desastres mayores. Cifras agregadas de
                INDECI; el eje vertical está en miles (k).
              </HelpTip>
            }
            right={<Pill tone="warn">cifras agregadas</Pill>}
          />
          <Chart option={damnOption} height={280} />
        </Card>
      </div>

      {/* 5. Banda de fuentes */}
      <Card>
        <CardHeader title="Fuentes" subtitle={`Última actualización: ${riesgoData.lastUpdate}`} />
        <div className="flex flex-wrap gap-2">
          {riesgoData.fuentes.map((f) => (
            <a
              key={f.url}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-300"
            >
              {f.name} ↗
            </a>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Leyenda({ color, t }: { color: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      {t}
    </span>
  )
}
