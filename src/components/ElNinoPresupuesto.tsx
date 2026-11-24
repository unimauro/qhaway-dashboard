import { useState } from 'react'
import { Card, CardHeader, HelpTip, Pill, Select } from './ui'
import { Chart, PALETA } from './Chart'
import { pct, solesCompact } from '../lib/format'
import { fechaCorta, nombreDepto, type FilaMit, type FilaSerie, type Mitigacion } from './ElNinoTipos'

/* Serie del PP 0068 (foco 2021–2027), PP 0068 en los departamentos expuestos y la
 * sección «Presupuesto 2027 para El Niño y mitigación». Fuente preferida:
 * mitigacion-2021-2027.json; si no está, la serie sale de por-programa-historico.json. */

interface Props {
  mit: Mitigacion | null
  /** filas 0068 de por-programa-historico.json (fallback y vista larga) */
  historico: FilaSerie[]
  eventos: { anio: string; intensidad: string }[]
  corte?: string
  anioVigente: number
}

/** «2023-24» → [2023, 2024]; «2017» → [2017] */
function aniosEvento(anio: string): number[] {
  const m = anio.match(/^(\d{4})(?:-(\d{2,4}))?/)
  if (!m) return []
  const a = Number(m[1])
  if (!m[2]) return [a]
  const b = m[2].length === 2 ? Number(m[1].slice(0, 2) + m[2]) : Number(m[2])
  return b > a ? [a, b] : [a]
}

type Tooltip = { axisValue: string; seriesName: string; value: number | null; marker: string }[]
const nfM = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** S/ 2,007.86 M (millones con dos decimales, para cifras de documento) */
const millones = (v: number | null | undefined) => (v == null ? '—' : `S/ ${nfM.format(v / 1e6)} M`)

const ejeMilM = { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 1e9).toFixed(1)} mil M` } }

const VERIF: Record<string, { t: string; tone: 'good' | 'warn' | 'neutral' }> = {
  documento_oficial: { t: 'documento oficial', tone: 'good' },
  consulta_amigable: { t: 'Consulta Amigable', tone: 'good' },
  clasificador_clima_mef: { t: 'clasificador MEF', tone: 'good' },
  prensa: { t: 'declaración (prensa)', tone: 'warn' },
}

export default function ElNinoPresupuesto({ mit, historico, eventos, corte, anioVigente }: Props) {
  const [rango, setRango] = useState<'2021' | 'todo'>('2021')
  const usaMit = !!mit && mit.serie0068.length > 0
  const base = usaMit ? mit!.serie0068 : historico
  // Vista larga: la serie completa del histórico + los años que solo trae el archivo nuevo (2027).
  const larga = [...historico, ...(usaMit ? mit!.serie0068.filter((f) => !historico.some((h) => h.year === f.year)) : [])]
    .sort((a, b) => a.year - b.year)
  const serie = rango === '2021' ? base.filter((f) => f.year >= 2021) : larga
  const anios = new Set(serie.map((s) => s.year))

  // Marcas El Niño: el primer año del evento con banda fuerte; el segundo, tenue.
  const marcas = eventos
    .flatMap((e) => aniosEvento(e.anio).map((y, i) => ({ year: y, evento: e.anio, principal: i === 0 })))
    .filter((m) => anios.has(m.year))

  const serieOption = {
    grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: Tooltip) => {
        const y = Number(ps[0]?.axisValue)
        const ev = marcas.find((m) => m.year === y)
        const s = serie.find((r) => r.year === y)
        const nota = s?.proyectado ? ' (proyecto: solo PIA)' : y === anioVigente && corte ? ` (corte ${fechaCorta(corte)})` : ''
        return `<b>${y}</b>${ev ? ` · El Niño ${ev.evento}` : ''}${nota}<br>` +
          ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}: ${solesCompact(p.value)}`).join('<br>') +
          (s?.pim && s.devengado != null && !s.proyectado ? `<br>Ejecución: ${pct(s.devengado / s.pim)}` : '') +
          (s?.pctPimTotal != null ? `<br>${s.pctPimTotal.toFixed(2)}% del presupuesto público` : '')
      },
    },
    xAxis: { type: 'category', data: serie.map((s) => String(s.year)) },
    yAxis: ejeMilM,
    series: [
      {
        name: 'PIM', type: 'bar', barMaxWidth: 30,
        data: serie.map((s) => (s.proyectado ? null : s.pim)),
        itemStyle: { color: '#0ea5e9', borderRadius: [4, 4, 0, 0] },
        markArea: {
          silent: true,
          label: { color: '#ef4444', fontSize: 10, position: 'insideTop' },
          data: marcas.map((m) => [
            { xAxis: String(m.year), name: m.principal ? `El Niño ${m.evento}` : '', itemStyle: { color: m.principal ? 'rgba(239,68,68,.14)' : 'rgba(239,68,68,.06)' } },
            { xAxis: String(m.year) },
          ]),
        },
      },
      {
        name: 'PIA de proyecto', type: 'bar', barMaxWidth: 30, barGap: '-100%',
        data: serie.map((s) => (s.proyectado ? s.pia ?? s.pim : null)),
        itemStyle: { color: 'rgba(14,165,233,.2)', borderColor: '#0ea5e9', borderType: 'dashed', borderWidth: 1.5, borderRadius: [4, 4, 0, 0] },
      },
      {
        name: 'Devengado', type: 'line', symbolSize: 6,
        data: serie.map((s) => (s.proyectado ? null : s.devengado ?? null)),
        lineStyle: { width: 3, color: '#14b8a6' }, itemStyle: { color: '#14b8a6' },
      },
      {
        name: 'PIA', type: 'line', symbolSize: 4,
        data: serie.map((s) => s.pia ?? null),
        lineStyle: { width: 1.5, type: 'dashed', color: '#94a3b8' }, itemStyle: { color: '#94a3b8' },
      },
    ],
  }

  // ── PP 0068 por departamento expuesto ──
  const regAnios = [...new Set(mit?.regiones.map((r) => r.year) ?? [])].sort((a, b) => a - b)
  const regNombres = [...new Set(mit?.regiones.map((r) => r.nombre) ?? [])]
  const regOption = {
    grid: { left: 8, right: 16, top: 56, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, type: 'scroll' },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: Tooltip) =>
        `<b>${ps[0]?.axisValue}</b><br>` +
        [...ps].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).map((p) => `${p.marker}${p.seriesName}: ${solesCompact(p.value)}`).join('<br>'),
    },
    xAxis: { type: 'category', data: regAnios.map(String) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 1e6).toFixed(0)} M` } },
    series: regNombres.map((nm, i) => ({
      name: nm, type: 'line', symbolSize: 5,
      data: regAnios.map((y) => mit?.regiones.find((r) => r.nombre === nm && r.year === y)?.pim ?? null),
      lineStyle: { width: 2 }, color: PALETA[i % PALETA.length],
      ...(i === 0 ? { markArea: { silent: true, data: marcas.filter((m) => regAnios.includes(m.year)).map((m) => [{ xAxis: String(m.year), itemStyle: { color: 'rgba(239,68,68,.08)' } }, { xAxis: String(m.year) }]) } } : {}),
    })),
  }

  // ── Mitigación / adaptación (clasificador climático MEF) ──
  const mitAd = mit?.mitAd.filter((f) => f.year >= 2021) ?? []
  const mitAdOption = {
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: Tooltip) => {
        const f = mitAd.find((x) => String(x.year) === ps[0]?.axisValue)
        return `<b>${ps[0]?.axisValue}</b>${f?.parcial ? ` (parcial${mit?.fechaCorte ? `, corte ${fechaCorta(mit.fechaCorte)}` : ''})` : ''}<br>` +
          ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}: ${solesCompact(p.value)}`).join('<br>')
      },
    },
    xAxis: { type: 'category', data: mitAd.map((f) => String(f.year)) },
    yAxis: ejeMilM,
    series: [
      { name: 'Mitigación', type: 'bar', data: mitAd.map((f) => f.mitigacion ?? null), itemStyle: { color: '#a3e635', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
      { name: 'Adaptación', type: 'bar', data: mitAd.map((f) => f.adaptacion ?? null), itemStyle: { color: '#0ea5e9', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
      { name: 'Mitigación y adaptación', type: 'bar', data: mitAd.map((f) => f.ambas ?? null), itemStyle: { color: '#818cf8', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
    ],
  }

  // ── 2027 ──
  const f27 = mit?.filas2027 ?? []
  const pp27 = f27.find((f) => f.serie === 'pp0068')
  const total27 = f27.find((f) => f.serie === 'total_sector_publico')
  const pia26 = base.find((s) => s.year === 2026)?.pia
  const nino27 = f27.filter((f) => f.serie === 'el_nino_2027')
  const ninoTotal = nino27.find((f) => /total/i.test(f.categoria))
  const partidas = f27.filter((f) => f.serie === 'partida_2027')
  const varPP = pia26 && pp27?.pia ? (pp27.pia - pia26) / pia26 : undefined
  // Estado del presupuesto 2027: si sigue como proyecto pero el Pleno ya lo aprobó (fuente pleno_2027).
  const pleno = mit?.fuentes.find((f) => f.id === 'pleno_2027')
  const estado27 = !total27 ? undefined
    : total27.estado === 'ley' ? 'ley publicada'
    : pleno?.fecha ? `proyecto aprobado por el Pleno (${fechaCorta(pleno.fecha)}), pendiente de publicación`
    : 'proyecto de ley'
  const proyectos = f27.filter((f) => f.serie === 'proyecto_2027_region').sort((a, b) => (b.pia ?? 0) - (a.pia ?? 0))

  const primero = serie[0]?.year
  const ultimo = serie[serie.length - 1]?.year

  return (
    <>
      <Card>
        <CardHeader
          title={`PP 0068 nacional, ${primero ?? ''}–${ultimo ?? ''}`}
          subtitle="PIA, PIM y devengado · bandas rojas = años El Niño"
          help={
            <HelpTip>
              El PIA es lo que se aprueba al inicio del año; el PIM, lo que se termina asignando. En los
              años El Niño el PIM sube por créditos de emergencia: el dinero llega después del desastre,
              no antes. La barra punteada de 2027 es el PIA del proyecto de presupuesto (aún sin PIM ni
              ejecución).{corte ? ` El ${anioVigente} tiene corte al ${fechaCorta(corte)}.` : ''}
            </HelpTip>
          }
          right={
            <Select
              label="Periodo"
              value={rango}
              onChange={setRango}
              options={[{ value: '2021', label: '2021–2027' }, { value: 'todo', label: 'Desde 2012' }]}
            />
          }
        />
        <div className="px-4 pb-4">
          <Chart option={serieOption} height={340} exportName="el-nino-pp0068-serie" />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-600 dark:text-ink-200">
            {marcas.filter((m) => m.principal).map((m) => {
              const s = serie.find((r) => r.year === m.year)
              return s && !s.proyectado ? (
                <span key={m.year} className="rounded-full border border-red-200 px-2 py-0.5 dark:border-red-900">
                  {m.evento}: PIM {solesCompact(s.pim)}
                  {s.pia ? ` = ${(s.pim / s.pia).toFixed(1)} × PIA` : ''}
                </span>
              ) : null
            })}
            <Pill tone="neutral">
              {usaMit ? 'fuente: mitigacion-2021-2027.json' : 'fuente: por-programa-historico.json'}
            </Pill>
          </div>
        </div>
      </Card>

      {regNombres.length > 0 && (
        <Card>
          <CardHeader
            title={`PP 0068 en los departamentos expuestos, ${regAnios[0]}–${regAnios[regAnios.length - 1]}`}
            subtitle="PIM por departamento (destino META)"
            help={
              <HelpTip>
                PIM del PP 0068 en cada departamento expuesto a El Niño. Lima va en su propia escala de
                magnitud porque concentra el gasto del gobierno nacional; haz clic en la leyenda para
                ocultarla y ver mejor el resto.
              </HelpTip>
            }
          />
          <div className="px-4 pb-4">
            <Chart option={regOption} height={320} exportName="el-nino-pp0068-regiones" />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Presupuesto 2027 para El Niño y mitigación"
          subtitle="Proyecto de Ley de Presupuesto 2027 y dictamen del Congreso"
          help={
            <HelpTip>
              Montos del proyecto o dictamen de presupuesto 2027: son asignaciones propuestas, no
              ejecutadas. Cada cifra indica cómo se verificó: «documento oficial» (exposición de motivos,
              dictamen) o «prensa» (cifra anunciada que no aparece desagregada en un documento oficial).
            </HelpTip>
          }
          right={estado27 ? <Pill tone="warn">{total27?.estado === 'ley' ? 'ley' : 'proyecto'}</Pill> : undefined}
        />
        <div className="space-y-4 px-4 pb-4">
          {!mit ? (
            <p className="rounded-xl bg-ink-50 px-3 py-6 text-center text-sm text-ink-400 dark:bg-ink-800/40">
              En preparación: aún no está disponible el archivo con el presupuesto 2027
              (mitigacion-2021-2027.json).
            </p>
          ) : (
            <>
              {estado27 && <p className="text-xs text-ink-400">Estado del presupuesto 2027: <b>{estado27}</b>.</p>}
              {pp27?.pia != null && pia26 != null && varPP != null && (
                <div className={`rounded-xl px-4 py-3 text-sm ${varPP < 0 ? 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
                  <b>Hallazgo:</b> el PIA 2027 del PP 0068 es <b>{millones(pp27.pia)}</b>, {varPP < 0 ? 'una caída de' : 'un aumento de'}{' '}
                  <b>{pct(Math.abs(varPP))}</b> frente al PIA 2026 ({millones(pia26)}){varPP < 0 ? ', en plena alerta por El Niño costero' : ''}.
                  {pp27.fuente_url && (
                    <a href={pp27.fuente_url} target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold underline">Fuente ↗</a>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {pp27 && (
                  <Dato
                    k="PP 0068 · PIA 2027"
                    v={millones(pp27.pia)}
                    sub={varPP != null && pia26 ? `${varPP >= 0 ? '+' : '−'}${pct(Math.abs(varPP))} frente al PIA 2026 (${millones(pia26)})` : undefined}
                    tag={VERIF[pp27.verificacion ?? '']}
                  />
                )}
                {ninoTotal && (
                  <Dato
                    k="El Niño 2027: total anunciado"
                    v={millones(ninoTotal.pia)}
                    sub={`${ninoTotal.verificacion === 'prensa' ? 'Declaración (prensa), no desagregado en la exposición de motivos. ' : ''}${ninoTotal.pct_pia_total != null ? `${ninoTotal.pct_pia_total.toFixed(2)}% del presupuesto 2027.` : ''}`}
                    tag={VERIF[ninoTotal.verificacion ?? '']}
                  />
                )}
                {total27 && (
                  <Dato k="Presupuesto público 2027" v={solesCompact(total27.pia)} sub={total27.fecha_corte ? `dictamen del ${fechaCorta(total27.fecha_corte)}` : undefined} tag={VERIF[total27.verificacion ?? '']} />
                )}
              </div>

              {partidas.length > 0 && <TablaPartidas filas={partidas} titulo="Partidas 2027 en el proyecto de presupuesto" />}
              {nino27.length > 0 && (
                <TablaPartidas
                  filas={nino27}
                  titulo="Anuncio del MEF para El Niño 2027: declaración (prensa), no desagregado en la exposición de motivos"
                />
              )}
              {proyectos.length > 0 && <TablaPartidas filas={proyectos} titulo="Proyectos 2027 en departamentos expuestos" region />}

              {mitAd.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Cambio climático (clasificador MEF): PIM por medida, {mitAd[0].year}–{mitAd[mitAd.length - 1].year}
                  </h4>
                  <Chart option={mitAdOption} height={280} exportName="el-nino-mitigacion-adaptacion" />
                  <p className="text-xs text-ink-400">
                    Las tres categorías son distintas y no se suman entre sí ni con el PP 0068 (se solapan).
                    Para 2027 el proyecto de presupuesto no cuantifica el gasto climático.
                  </p>
                </div>
              )}

              {mit.noVerificado2027 && (
                <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  ⚠ <b>Sin dato oficial 2027.</b> {mit.noVerificado2027}
                </div>
              )}

              {mit.fuentes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {mit.fuentes.map((f) => (
                    <a
                      key={f.id}
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={f.titulo}
                      className="max-w-full truncate rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-600 transition hover:border-brand-500 hover:text-brand-600 dark:border-ink-800 dark:text-ink-200"
                    >
                      {f.titulo.length > 70 ? `${f.titulo.slice(0, 68)}…` : f.titulo}
                      {f.fecha ? ` · ${fechaCorta(f.fecha)}` : ''} ↗
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </>
  )
}

function TablaPartidas({ filas, titulo, region }: { filas: FilaMit[]; titulo: string; region?: boolean }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{titulo}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-400">
              {region && <th className="py-1.5 pr-3 font-medium">Departamento</th>}
              <th className="py-1.5 pr-3 font-medium">{region ? 'Proyecto' : 'Partida'}</th>
              <th className="py-1.5 pr-3 text-right font-medium">Monto 2027</th>
              {!region && <th className="py-1.5 pr-3 text-right font-medium">% del total</th>}
              <th className="py-1.5 font-medium">Verificación</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const v = VERIF[f.verificacion ?? '']
              return (
                <tr key={i} className="border-t border-ink-200 align-top dark:border-ink-800">
                  {region && <td className="py-1.5 pr-3 font-medium text-ink-900 dark:text-ink-50">{nombreDepto(f.ubigeo, f.ambito)}</td>}
                  <td className="py-1.5 pr-3">
                    <span className={/total/i.test(f.categoria) && !region ? 'font-semibold' : ''}>{f.categoria}</span>
                    {f.nota && <p className="mt-0.5 text-xs text-ink-400">{f.nota}</p>}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{millones(f.pia)}</td>
                  {!region && <td className="py-1.5 pr-3 text-right tabular-nums">{f.pct_pia_total != null ? `${f.pct_pia_total.toFixed(2)}%` : '—'}</td>}
                  <td className="py-1.5 whitespace-nowrap">
                    {v ? <Pill tone={v.tone}>{v.t}</Pill> : <Pill>{f.verificacion ?? '—'}</Pill>}
                    {f.fuente_url && (
                      <a href={f.fuente_url} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-xs text-brand-600 hover:underline dark:text-brand-300">
                        fuente ↗
                      </a>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Dato({ k, v, sub, tag }: { k: string; v: string; sub?: string; tag?: { t: string; tone: 'good' | 'warn' | 'neutral' } }) {
  return (
    <div className="rounded-xl border border-ink-200 px-3 py-2 dark:border-ink-800">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-400">{k}</p>
        {tag && <Pill tone={tag.tone}>{tag.t}</Pill>}
      </div>
      <p className="text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">{v}</p>
      {sub && <p className="text-xs text-ink-400">{sub}</p>}
    </div>
  )
}
