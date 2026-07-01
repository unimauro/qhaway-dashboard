import { useMemo, useState } from 'react'
import { getGeoJSON, loadJSON } from '../lib/data'
import type { IndicadorDistrito } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { num, pct } from '../lib/format'
import { Card, CardHeader, HelpTip, KPI, Pill, Loading, ErrorBox, SectionIntro } from '../components/ui'
import { Chart } from '../components/Chart'
import IndicadorPanel, { type DistritoIndic } from '../components/IndicadorPanel'
import IndicadorPendiente from '../components/IndicadorPendiente'

// ─────────────────────────────────────────────────────────────────────────────
//  Desarrollo Humano y Densidad del Estado (ruta /prosperidad)
//
//  Reemplazo del antiguo "IPT (Prosperidad/Felicidad)" — un índice compuesto con
//  pesos arbitrarios y framing opaco — por un TABLERO DE INDICADORES reconocidos
//  y CITABLES. No combinamos nada en un número único: cada indicador se presenta
//  con su propio mapa/ranking distrital + FUENTE + AÑO + nota metodológica.
//
//  Indicadores con dato real cargado hoy (public/data/indicadores-distrito.json):
//   - IDH (PNUD, IDH distrital 2019)
//   - Pobreza monetaria (INEI, mapa de pobreza)
//   - Pobreza extrema (INEI)
//   - Vulnerabilidad alimentaria (INEI/MIDIS)
//   - Acceso a servicios: agua, desagüe, electricidad, internet (INEI, Censo 2017,
//     vía REDATAM CPV2017DI; ver etl/build_ide.py). 1 874 distritos.
//   - Densidad del Estado (IDE) — reconstrucción desde Censo 2017, 2 de 4 dimensiones
//     (agua+saneamiento y electrificación). Salud y educación pendientes.
//
//  Dimensiones IDE reconocidas pero AÚN SIN dato distrital limpio (null, pendientes):
//   - salud (médicos por 10 000 hab.) y educación (asistencia neta a secundaria).
// ─────────────────────────────────────────────────────────────────────────────

interface GeoNombre {
  nombre: string
  provincia: string
  departamento: string
  iddpto: string
}

interface DistritoBase {
  ubigeo: string
  nombre: string
  provincia: string
  departamento: string
  iddpto: string
  ind: IndicadorDistrito
}

// ── Promedio simple 0..1 de las dimensiones IDE disponibles (reconstrucción IDE-4D) ──
// PNUD 2025: IDE = promedio simple de 4 dimensiones (salud, educación, agua+saneamiento,
// electricidad), cada una 0..1. Si faltan dimensiones, promediamos las que haya y lo
// indicamos. "salud" es REFERENCIAL (médicos/10k, sensible a movilidad poblacional).
function calcularIDE(i: IndicadorDistrito): number | null {
  const dims = [i.ideSalud, i.ideEducacion, i.ideAgua, i.ideElectricidad].filter(
    (d): d is number => d != null && Number.isFinite(d),
  )
  if (dims.length === 0) return null
  return dims.reduce((a, d) => a + d, 0) / dims.length
}

export default function Prosperidad() {
  const geoQ = useAsync(() => getGeoJSON(), [])
  const indQ = useAsync(() => loadJSON<IndicadorDistrito[]>('indicadores-distrito.json'), [])

  const [seleccionado, setSeleccionado] = useState<string | undefined>(undefined)

  // ubigeo6 → nombre/provincia/departamento desde el geojson.
  const nombres = useMemo<Map<string, GeoNombre>>(() => {
    const m = new Map<string, GeoNombre>()
    if (!geoQ.data) return m
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of (geoQ.data as any).features) {
      const p = f.properties
      m.set(p.IDDIST, { nombre: p.NOMBDIST, provincia: p.NOMBPROV, departamento: p.NOMBDEP, iddpto: p.IDDPTO })
    }
    return m
  }, [geoQ.data])

  // Distritos enriquecidos con su nombre/territorio.
  const distritos = useMemo<DistritoBase[]>(() => {
    if (!indQ.data) return []
    const out: DistritoBase[] = []
    for (const d of indQ.data) {
      const geo = nombres.get(d.ubigeo)
      out.push({
        ubigeo: d.ubigeo,
        nombre: geo?.nombre ?? d.ubigeo,
        provincia: geo?.provincia ?? '—',
        departamento: geo?.departamento ?? '—',
        iddpto: geo?.iddpto ?? d.ubigeo.slice(0, 2),
        ind: d,
      })
    }
    return out
  }, [indQ.data, nombres])

  // Helper: construye las filas de un panel a partir de un extractor de valor.
  const filasDe = (extractor: (i: IndicadorDistrito) => number | null | undefined): DistritoIndic[] => {
    const out: DistritoIndic[] = []
    for (const d of distritos) {
      const v = extractor(d.ind)
      if (v == null || !Number.isFinite(v)) continue
      out.push({
        ubigeo: d.ubigeo,
        nombre: d.nombre,
        provincia: d.provincia,
        departamento: d.departamento,
        iddpto: d.iddpto,
        valor: v,
        pob: Number.isFinite(d.ind.pob) ? d.ind.pob : 0,
      })
    }
    return out
  }

  // Filas por indicador (memorizadas).
  const filasIdh = useMemo(() => filasDe((i) => i.idh), [distritos])
  const filasPobreza = useMemo(() => filasDe((i) => i.pobreza), [distritos])
  const filasPobrezaExt = useMemo(() => filasDe((i) => i.pobrezaExt), [distritos])
  const filasVuln = useMemo(() => filasDe((i) => i.vulnAlim), [distritos])

  // ¿Hay dato de servicios / IDE cargado? Si no, mostramos "en preparación".
  const hayAgua = useMemo(() => distritos.some((d) => d.ind.agua != null), [distritos])
  const hayDesague = useMemo(() => distritos.some((d) => d.ind.desague != null), [distritos])
  const hayElectricidad = useMemo(() => distritos.some((d) => d.ind.electricidad != null), [distritos])
  const hayInternet = useMemo(() => distritos.some((d) => d.ind.internet != null), [distritos])
  const filasIde = useMemo(() => filasDe((i) => calcularIDE(i)), [distritos])
  const hayIde = filasIde.length > 0

  // KPIs nacionales (promedio ponderado por población del IDH, como indicador insignia).
  const kpis = useMemo(() => {
    if (filasIdh.length === 0) return null
    let sumPob = 0
    let sumIdhPob = 0
    let mejor = filasIdh[0]
    let peor = filasIdh[0]
    for (const f of filasIdh) {
      const pob = Number.isFinite(f.pob) ? f.pob : 0
      sumPob += pob
      sumIdhPob += f.valor * pob
      if (f.valor > mejor.valor) mejor = f
      if (f.valor < peor.valor) peor = f
    }
    const prom = sumPob > 0 ? sumIdhPob / sumPob : filasIdh.reduce((a, f) => a + f.valor, 0) / filasIdh.length
    return { prom, mejor, peor, n: filasIdh.length }
  }, [filasIdh])

  // Ficha del distrito seleccionado (todos sus indicadores reales, sin compositar).
  const ficha = useMemo(() => distritos.find((d) => d.ubigeo === seleccionado), [distritos, seleccionado])

  // ── Dispersión IDH vs Pobreza (lectura cruzada, NO un índice) ──
  const scatterOption = useMemo(() => {
    const byUb = new Map(filasPobreza.map((f) => [f.ubigeo, f.valor]))
    const datos = filasIdh
      .filter((f) => byUb.has(f.ubigeo) && Number.isFinite(f.pob))
      .map((f) => ({
        value: [f.valor, byUb.get(f.ubigeo)!, f.pob],
        name: f.nombre,
        dep: f.departamento,
      }))
    const maxPob = Math.max(1, ...datos.map((p) => p.value[2]))
    return {
      tooltip: {
        trigger: 'item',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) =>
          `<b>${p.name}</b> · ${p.data?.dep ?? ''}<br/>IDH: ${p.value[0].toFixed(1)}<br/>Pobreza: ${pct(p.value[1] / 100)}<br/>Población: ${num(p.value[2])}`,
      },
      xAxis: { name: 'IDH → mayor desarrollo', nameLocation: 'middle', nameGap: 28, type: 'value', min: 0 },
      yAxis: { name: 'Pobreza (%) →', nameLocation: 'middle', nameGap: 40, type: 'value', min: 0 },
      series: [
        {
          type: 'scatter',
          data: datos,
          itemStyle: { color: '#14b8a6', opacity: 0.5 },
          symbolSize: (val: number[]) => 6 + 24 * Math.sqrt(val[2] / maxPob),
        },
      ],
    }
  }, [filasIdh, filasPobreza])

  // ───────── Estados ─────────
  if (geoQ.loading || indQ.loading) return <Loading label="Cargando indicadores territoriales…" />
  if (geoQ.error) return <ErrorBox error={geoQ.error} />
  if (indQ.error) return <ErrorBox error={indQ.error} />
  if (!geoQ.data || !indQ.data) return <Loading />
  if (!kpis || filasIdh.length === 0)
    return <ErrorBox error="No hay distritos con indicadores cargados." />

  return (
    <div className="space-y-6">
      <SectionIntro title="Desarrollo Humano y Densidad del Estado">
        Un <strong>tablero de indicadores reconocidos y citables</strong> por distrito. A diferencia de un
        índice compuesto con pesos arbitrarios, aquí cada indicador se muestra <strong>por separado</strong>,
        con su fuente, su año y su nota metodológica. Así puedes leer el desarrollo humano, la pobreza, la
        vulnerabilidad, el acceso a servicios básicos (Censo 2017) y —como reconstrucción— la densidad del
        Estado, sin esconderlos detrás de un solo número.
      </SectionIntro>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="good">Indicadores citables</Pill>
        <span className="text-sm text-ink-500 dark:text-ink-300">
          Sin índice compuesto opaco. Cada tarjeta cita su fuente oficial (PNUD / INEI) y su año.
        </span>
      </div>

      {/* ── Resumen IDH nacional ── */}
      <Card>
        <CardHeader
          title="Desarrollo Humano nacional — resumen"
          subtitle="Indicador insignia: IDH distrital (PNUD 2019)"
          help={
            <HelpTip>
              El IDH (Índice de Desarrollo Humano) del PNUD combina esperanza de vida, logro educativo e
              ingreso familiar per cápita. Aquí lo presentamos tal cual lo publica el PNUD: no lo mezclamos
              con otros indicadores. El promedio nacional es ponderado por población.
            </HelpTip>
          }
        />
        <div className="px-4 pb-2 grid grid-cols-1 md:grid-cols-3 gap-4">
          <KPI
            label="IDH nacional (ponderado por población)"
            value={kpis.prom.toFixed(1)}
            sub={`${num(kpis.n)} distritos con dato`}
            accent
          />
          <KPI
            label="Distrito con mayor IDH"
            value={kpis.mejor.valor.toFixed(1)}
            sub={`${kpis.mejor.nombre} · ${kpis.mejor.departamento}`}
          />
          <KPI
            label="Distrito con menor IDH"
            value={kpis.peor.valor.toFixed(1)}
            sub={`${kpis.peor.nombre} · ${kpis.peor.departamento}`}
          />
        </div>
        <p className="px-4 pb-4 text-xs text-ink-400">
          <strong>Fuente:</strong> PNUD, IDH distrital 2019 (escala 0–100). Es el indicador más reciente con
          cobertura distrital completa publicado por el PNUD para el Perú.
        </p>
      </Card>

      {/* ── Ficha del distrito (todos sus indicadores reales, sin compositar) ── */}
      {ficha && (
        <Card>
          <CardHeader
            title={`Ficha distrital · ${ficha.nombre}`}
            subtitle={`${ficha.provincia}, ${ficha.departamento}`}
            right={
              <button
                onClick={() => setSeleccionado(undefined)}
                className="rounded-lg border border-ink-200 dark:border-ink-800 px-2.5 py-1 text-xs text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800 transition"
              >
                Cerrar
              </button>
            }
          />
          <dl className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Dato label="IDH (PNUD 2019)" valor={ficha.ind.idh != null ? ficha.ind.idh.toFixed(1) : '—'} />
            <Dato label="Pobreza (INEI)" valor={ficha.ind.pobreza != null ? pct(ficha.ind.pobreza / 100) : '—'} />
            <Dato label="Pobreza extrema (INEI)" valor={ficha.ind.pobrezaExt != null ? pct(ficha.ind.pobrezaExt / 100) : '—'} />
            <Dato label="Vuln. alimentaria (INEI)" valor={ficha.ind.vulnAlim != null ? pct(ficha.ind.vulnAlim / 100) : '—'} />
            <Dato label="Población" valor={Number.isFinite(ficha.ind.pob) ? num(ficha.ind.pob) : '—'} />
            <Dato label="Altitud" valor={ficha.ind.altitud != null ? `${num(ficha.ind.altitud)} msnm` : '—'} />
            <Dato label="Agua red púb. (Censo 2017)" valor={ficha.ind.agua != null ? pct(ficha.ind.agua / 100) : 'en prep.'} />
            <Dato label="Desagüe red púb. (Censo 2017)" valor={ficha.ind.desague != null ? pct(ficha.ind.desague / 100) : 'en prep.'} />
            <Dato label="Electricidad (Censo 2017)" valor={ficha.ind.electricidad != null ? pct(ficha.ind.electricidad / 100) : 'en prep.'} />
            <Dato label="Internet hogar (Censo 2017)" valor={ficha.ind.internet != null ? pct(ficha.ind.internet / 100) : 'en prep.'} />
            <Dato label="IDE (2 de 4 dim.)" valor={calcularIDE(ficha.ind) != null ? calcularIDE(ficha.ind)!.toFixed(2) : 'en prep.'} />
          </dl>
        </Card>
      )}

      {/* ── 1. IDH ── */}
      <IndicadorPanel
        titulo="Desarrollo Humano (IDH)"
        subtitulo="Por distrito · 0–100, mayor es mejor"
        help={
          <>
            IDH del PNUD: esperanza de vida, logro educativo e ingreso familiar per cápita, sintetizados en
            una escala 0–100. Verde = mayor desarrollo humano; rojo = menor. Toca un distrito para su ficha.
          </>
        }
        filas={filasIdh}
        geojson={geoQ.data}
        formatValor={(v) => v.toFixed(1)}
        mayorEsMejor
        unidad="IDH"
        fuente="PNUD, IDH distrital 2019"
        nota="Escala 0–100. Es el IDH distrital más reciente publicado por el PNUD."
        exportName="idh-distrital"
        seleccionado={seleccionado}
        onSelect={setSeleccionado}
      />

      {/* ── 2. Densidad del Estado (IDE-4D) ── */}
      {hayIde ? (
        <IndicadorPanel
          titulo="Densidad del Estado (IDE)"
          subtitulo="Reconstrucción · 0–1, mayor es mejor"
          help={
            <>
              Reconstrucción del Índice de Densidad del Estado (PNUD) como <strong>promedio simple</strong> de
              las dimensiones <strong>disponibles</strong> (0–1). Hoy están cargadas <strong>2 de las 4</strong>{' '}
              dimensiones, ambas del Censo 2017 (INEI): <em>agua + saneamiento</em> (promedio de % de viviendas
              con agua y con desagüe por red pública) y <em>electrificación</em> (% de viviendas con alumbrado
              eléctrico por red). Las dimensiones <em>salud</em> (médicos por 10 000 hab.) y <em>educación</em>{' '}
              (asistencia neta a secundaria) aún no se cargan y se promedian solo las presentes. El IDE oficial
              del PNUD es provincial (2009); el distrital solo aparece en su informe 2025 (PDF). Esto es una{' '}
              <strong>reconstrucción propia</strong>, no la cifra oficial.
            </>
          }
          filas={filasIde}
          geojson={geoQ.data}
          formatValor={(v) => v.toFixed(2)}
          mayorEsMejor
          unidad="IDE"
          fuente="Reconstrucción QHAWAY a partir del Censo 2017 (INEI), metodología IDE (PNUD)"
          nota="Promedio simple (0–1) de 2 de las 4 dimensiones PNUD: agua+saneamiento y electrificación (Censo 2017). Salud y educación pendientes. No es la cifra oficial del PNUD."
          caveat="reconstrucción · 2 de 4 dim."
          exportName="ide-distrital"
          seleccionado={seleccionado}
          onSelect={setSeleccionado}
        />
      ) : (
        <IndicadorPendiente
          titulo="Densidad del Estado (IDE-4D)"
          subtitulo="Presencia del Estado por distrito"
          fuentePrevista="Reconstrucción a partir del Censo 2017 (INEI) — metodología IDE del PNUD (informe 2025)."
          metodologia={
            <>
              El Índice de Densidad del Estado (IDE) del PNUD mide la presencia del Estado.{' '}
              <strong>Reconstrucción IDE-4D</strong> = promedio simple (0–1) de 4 dimensiones:{' '}
              <em>salud</em> (médicos por 10 000 hab. — <strong>referencial</strong>, sensible a la movilidad),{' '}
              <em>educación</em> (asistencia neta a secundaria), <em>agua + saneamiento</em> (% de viviendas) y{' '}
              <em>electricidad</em> (% de viviendas). <strong>Caveat:</strong> el IDE oficial es{' '}
              <strong>provincial (2009)</strong>; el distrital solo existe en el informe PNUD 2025 (PDF). El IDE
              distrital reconstruido aquí será explícitamente una <strong>reconstrucción</strong>, no la cifra
              oficial. Pendiente: extraer las 4 dimensiones del Censo 2017 (REDATAM no ofrece descarga directa).
            </>
          }
        />
      )}

      {/* ── 3. Acceso a servicios (Censo 2017) ── */}
      <div className="grid grid-cols-1 gap-6">
        {hayAgua ? (
          <IndicadorPanel
            titulo="Acceso a agua por red pública"
            subtitulo="% de viviendas · mayor es mejor"
            filas={filasDe((i) => i.agua)}
            geojson={geoQ.data}
            formatValor={(v) => pct(v / 100)}
            mayorEsMejor
            unidad="% agua"
            fuente="INEI, Censos Nacionales 2017 (XII de Población, VII de Vivienda)"
            nota="% de viviendas particulares con agua por red pública (dentro o fuera de la vivienda, dentro de la edificación). No incluye pilón de uso público. Nacional 78.3%."
            exportName="agua-distrital"
            seleccionado={seleccionado}
            onSelect={setSeleccionado}
          />
        ) : (
          <ServicioPendiente nombre="Acceso a agua por red pública" />
        )}

        {hayDesague ? (
          <IndicadorPanel
            titulo="Acceso a desagüe por red pública"
            subtitulo="% de viviendas · mayor es mejor"
            filas={filasDe((i) => i.desague)}
            geojson={geoQ.data}
            formatValor={(v) => pct(v / 100)}
            mayorEsMejor
            unidad="% desagüe"
            fuente="INEI, Censos Nacionales 2017"
            nota="% de viviendas particulares con desagüe conectado a red pública (dentro o fuera de la vivienda). Nacional 66.6%."
            exportName="desague-distrital"
            seleccionado={seleccionado}
            onSelect={setSeleccionado}
          />
        ) : (
          <ServicioPendiente nombre="Acceso a desagüe por red pública" />
        )}

        {hayElectricidad ? (
          <IndicadorPanel
            titulo="Acceso a electricidad por red"
            subtitulo="% de viviendas · mayor es mejor"
            filas={filasDe((i) => i.electricidad)}
            geojson={geoQ.data}
            formatValor={(v) => pct(v / 100)}
            mayorEsMejor
            unidad="% luz"
            fuente="INEI, Censos Nacionales 2017"
            nota="% de viviendas particulares con alumbrado eléctrico por red pública. Nacional 87.7%."
            exportName="electricidad-distrital"
            seleccionado={seleccionado}
            onSelect={setSeleccionado}
          />
        ) : (
          <ServicioPendiente nombre="Acceso a electricidad por red" />
        )}

        {hayInternet ? (
          <IndicadorPanel
            titulo="Acceso a internet en la vivienda"
            subtitulo="% de viviendas · mayor es mejor"
            filas={filasDe((i) => i.internet)}
            geojson={geoQ.data}
            formatValor={(v) => pct(v / 100)}
            mayorEsMejor
            unidad="% internet"
            fuente="INEI, Censos Nacionales 2017"
            nota="% de hogares con conexión a internet en la vivienda. Nacional 28.0%."
            exportName="internet-distrital"
            seleccionado={seleccionado}
            onSelect={setSeleccionado}
          />
        ) : (
          <ServicioPendiente nombre="Acceso a internet en la vivienda" />
        )}
      </div>

      {/* ── 4. Pobreza monetaria ── */}
      <IndicadorPanel
        titulo="Pobreza monetaria"
        subtitulo="% de población · menor es mejor"
        help={
          <>
            Porcentaje de la población en situación de pobreza monetaria. Aquí <strong>verde = menos
            pobreza</strong> y rojo = más. Lo mostramos como indicador claro y separado, no escondido dentro de
            un índice.
          </>
        }
        filas={filasPobreza}
        geojson={geoQ.data}
        formatValor={(v) => pct(v / 100)}
        mayorEsMejor={false}
        unidad="% pobreza"
        fuente="INEI, mapa de pobreza monetaria distrital"
        nota="Porcentaje de población. Verde = menor pobreza."
        exportName="pobreza-distrital"
        seleccionado={seleccionado}
        onSelect={setSeleccionado}
      />

      {/* ── 5. Pobreza extrema ── */}
      <IndicadorPanel
        titulo="Pobreza extrema"
        subtitulo="% de población · menor es mejor"
        filas={filasPobrezaExt}
        geojson={geoQ.data}
        formatValor={(v) => pct(v / 100)}
        mayorEsMejor={false}
        unidad="% pobreza ext."
        fuente="INEI, mapa de pobreza distrital"
        nota="Porcentaje de población. Verde = menor pobreza extrema."
        exportName="pobreza-extrema-distrital"
        seleccionado={seleccionado}
        onSelect={setSeleccionado}
      />

      {/* ── 6. Vulnerabilidad alimentaria ── */}
      <IndicadorPanel
        titulo="Vulnerabilidad alimentaria"
        subtitulo="Índice/porcentaje · menor es mejor"
        filas={filasVuln}
        geojson={geoQ.data}
        formatValor={(v) => pct(v / 100)}
        mayorEsMejor={false}
        unidad="% vuln."
        fuente="INEI/MIDIS, vulnerabilidad a la inseguridad alimentaria distrital"
        nota="Verde = menor vulnerabilidad."
        exportName="vulnerabilidad-alimentaria-distrital"
        seleccionado={seleccionado}
        onSelect={setSeleccionado}
      />

      {/* ── 7. Lectura cruzada IDH vs Pobreza ── */}
      <Card>
        <CardHeader
          title="Lectura cruzada · IDH vs Pobreza"
          subtitle="Cada punto es un distrito"
          help={
            <HelpTip>
              Eje X = IDH (más desarrollo a la derecha). Eje Y = pobreza monetaria (más arriba, más pobreza).
              El tamaño del punto es la población. Esto <strong>no</strong> es un índice: es una lectura
              conjunta de dos indicadores publicados por separado. Lo esperado es una nube descendente; los
              puntos atípicos son territorios a observar.
            </HelpTip>
          }
        />
        <div className="px-4 pb-4">
          <Chart option={scatterOption} height={460} exportName="idh-vs-pobreza" />
        </div>
      </Card>

      {/* ── Nota metodológica final ── */}
      <Card>
        <CardHeader title="Nota metodológica y fuentes" subtitle="Transparencia y citación" />
        <div className="px-4 pb-4 text-sm text-ink-500 dark:text-ink-300 space-y-2">
          <p>
            Este módulo <strong>no construye un índice compuesto</strong>. Presenta indicadores oficiales por
            separado, cada uno con su fuente y año, para que cualquiera pueda citarlos y verificarlos. No usamos
            el término "felicidad" ni "prosperidad": medimos desarrollo humano, carencias y presencia del Estado
            con cifras atribuibles.
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>
              <strong>IDH:</strong> PNUD, IDH distrital 2019 (escala 0–100).
            </li>
            <li>
              <strong>Pobreza, pobreza extrema, vulnerabilidad alimentaria:</strong> INEI (mapas de pobreza
              monetaria distrital; vulnerabilidad a la inseguridad alimentaria INEI/MIDIS).
            </li>
            <li>
              <strong>Densidad del Estado (IDE):</strong> reconstrucción a partir del Censo 2017 (INEI) según la
              metodología IDE del PNUD (promedio simple de las dimensiones disponibles, 0–1). Hoy carga{' '}
              <strong>2 de las 4</strong> dimensiones: agua+saneamiento (promedio de agua y desagüe por red
              pública) y electrificación. Salud (médicos/10k) y educación (asistencia neta a secundaria) quedan
              pendientes. El IDE oficial del PNUD es provincial (2009); el distrital solo está en su informe 2025
              (PDF). Es una <strong>reconstrucción</strong>, no la cifra oficial.
            </li>
            <li>
              <strong>Acceso a servicios (agua, desagüe, electricidad, internet):</strong> INEI, Censos
              Nacionales 2017 (% de viviendas particulares; internet a nivel de hogar). Extraídos de{' '}
              <strong>REDATAM en línea, base CPV2017DI</strong> (frecuencia de cada variable con corte por
              distrito). Cobertura: 1 874 distritos con dato censal. Los agregados nacionales reconstruidos
              coinciden con las cifras publicadas por el INEI (agua 78.3 %, desagüe 66.6 %, electricidad 87.7 %,
              internet 28.0 %).
            </li>
          </ul>
          <p className="text-xs">
            Los indicadores marcados <Pill tone="warn">en preparación</Pill> aún no muestran cifras para no
            inventar datos: documentamos su metodología y fuente prevista mientras se consigue el dato distrital
            limpio.
          </p>
        </div>
      </Card>
    </div>
  )
}

// ───────────────────────── Subcomponentes ─────────────────────────

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="font-medium text-ink-800 dark:text-ink-100">{valor}</dd>
    </div>
  )
}

function ServicioPendiente({ nombre }: { nombre: string }) {
  return (
    <IndicadorPendiente
      titulo={nombre}
      subtitulo="% de viviendas por distrito"
      fuentePrevista="INEI, Censos Nacionales 2017 (XII de Población, VII de Vivienda) — % de viviendas particulares con el servicio."
      metodologia={
        <>
          Porcentaje de viviendas particulares del distrito con acceso al servicio, según el Censo 2017 del
          INEI. <strong>Pendiente de carga:</strong> el detalle distrital del Censo se obtiene vía REDATAM /
          EstaDist (consultas interactivas), que no ofrecen descarga directa de un CSV limpio. Se publicará el
          mapa/ranking cuando consolidemos el dato distrital. No mostramos cifras estimadas para evitar
          overclaiming.
        </>
      }
    />
  )
}
