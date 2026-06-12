import { getMeta } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import {
  Card,
  CardHeader,
  HelpTip,
  Pill,
  Loading,
  ErrorBox,
  SectionIntro,
} from '../components/ui'

const GITHUB_ISSUES =
  'https://github.com/unimauro/qhaway-dashboard/issues'

interface GuiaGrafico {
  nombre: string
  icono: string
  como: string
  cuidado: string
}

const GUIA_GRAFICOS: GuiaGrafico[] = [
  {
    nombre: 'Tooltips (información al pasar el cursor)',
    icono: '🖱️',
    como: 'Pasa el cursor sobre una barra, línea, sector del mapa o celda para ver el detalle exacto: nombre del territorio o categoría y el monto en soles. En móvil, toca el elemento para que aparezca el mismo cuadro.',
    cuidado: 'El tooltip muestra el valor real; el tamaño o color del elemento es solo una aproximación visual de ese número.',
  },
  {
    nombre: 'Mapa coroplético (mapa por colores)',
    icono: '🗺️',
    como: 'Cada distrito o departamento se pinta con una intensidad de color proporcional a su valor (PIM, devengado, etc.): más oscuro = mayor monto. Toca o pasa el cursor para ver la cifra exacta.',
    cuidado: 'Un área geográfica grande NO significa más presupuesto. Distritos amazónicos enormes pueden tener montos pequeños y viceversa. Lee el color, no el tamaño.',
  },
  {
    nombre: 'Series temporales (líneas en el tiempo)',
    icono: '📈',
    como: 'El eje horizontal son los años y el vertical el monto. Cada línea es una fase del gasto o un nivel de gobierno. Sirve para ver tendencias y comparar trayectorias entre años.',
    cuidado: 'Los montos están en soles corrientes (no ajustados por inflación). Un crecimiento nominal no equivale necesariamente a mayor poder de gasto real.',
  },
  {
    nombre: 'Diagrama Sankey (flujo de fases)',
    icono: '🔀',
    como: 'Muestra cómo el presupuesto recorre las fases del gasto (PIA → PIM → Certificado → Devengado → Girado). El ancho de cada banda es proporcional al monto que avanza a la siguiente fase.',
    cuidado: 'Las pérdidas de ancho entre fases representan presupuesto que no avanzó (no certificado, no devengado o no girado), es decir, capacidad de ejecución no concretada.',
  },
  {
    nombre: 'Treemap (rectángulos anidados)',
    icono: '🟦',
    como: 'Cada rectángulo es una categoría (función, sector, pliego) y su área es proporcional a su participación en el total. Útil para ver de un vistazo qué pesa más.',
    cuidado: 'El área comunica proporción, no ranking exacto. Para comparar dos categorías parecidas, usa el tooltip con la cifra precisa.',
  },
  {
    nombre: 'Heatmap (mapa de calor)',
    icono: '🌡️',
    como: 'Una cuadrícula donde el color de cada celda indica la intensidad de un valor (por ejemplo, ejecución por año y nivel). Más intenso = valor más alto.',
    cuidado: 'La escala de color es relativa al rango mostrado. Compara siempre contra la leyenda, no entre gráficos distintos.',
  },
  {
    nombre: 'Rankings (PIM vs devengado, per cápita vs absoluto)',
    icono: '🏆',
    como: 'Ordenan territorios de mayor a menor. Distinguimos PIM (presupuesto disponible) de devengado (lo efectivamente ejecutado), y montos absolutos de montos per cápita (divididos entre la población).',
    cuidado: 'Un territorio puede liderar en monto absoluto pero quedar abajo per cápita (mucha población) o al revés. Lee siempre qué columna ordena el ranking.',
  },
  {
    nombre: 'Índice compuesto IPT (Índice de Priorización Territorial)',
    icono: '🧭',
    como: 'Combina varias señales (presupuesto, necesidad, ejecución) en un número comparativo entre territorios. Sirve para ordenar y contrastar, no para fijar una meta.',
    cuidado: 'Es un índice COMPARATIVO y PARCIAL: tiene sentido frente a otros territorios del mismo período, no como valor absoluto ni como predicción.',
  },
]

interface Termino {
  termino: string
  def: string
}

const GLOSARIO: Termino[] = [
  { termino: 'PIA', def: 'Presupuesto Institucional de Apertura: el monto aprobado al inicio del año fiscal en la Ley de Presupuesto.' },
  { termino: 'PIM', def: 'Presupuesto Institucional Modificado: el PIA ajustado durante el año con créditos suplementarios, transferencias y modificaciones. Es el techo vigente de gasto.' },
  { termino: 'Certificado', def: 'Certificación de crédito presupuestario: acto que garantiza que existe presupuesto disponible para comprometer un gasto futuro.' },
  { termino: 'Comprometido', def: 'Compromiso: la entidad se obliga a realizar un gasto (contrato, orden de compra) afectando el presupuesto certificado.' },
  { termino: 'Devengado', def: 'Reconocimiento de una obligación de pago tras recibir el bien o servicio. Es la fase más usada para medir ejecución del gasto.' },
  { termino: 'Girado', def: 'Emisión del pago (cheque, transferencia) que cancela la obligación devengada. Es el último paso del ciclo.' },
  { termino: 'Ejecución', def: 'Avance del gasto, normalmente devengado dividido entre PIM, expresado en porcentaje (0–100%).' },
  { termino: 'Programa Presupuestal', def: 'Conjunto de acciones articuladas a un resultado específico para la población (enfoque de Presupuesto por Resultados).' },
  { termino: 'Función', def: 'Clasificación del gasto según la finalidad del Estado (Educación, Salud, Transporte, Saneamiento, etc.).' },
  { termino: 'Pliego', def: 'Entidad pública titular de un presupuesto (un ministerio, un gobierno regional, una municipalidad).' },
  { termino: 'Unidad Ejecutora', def: 'Dependencia de un pliego con autonomía para ejecutar presupuesto y registrar operaciones en el SIAF.' },
  { termino: 'UBIGEO', def: 'Código geográfico oficial del INEI: 2 dígitos = departamento, 4 = provincia, 6 = distrito. Permite cruzar datos con el mapa.' },
  { termino: 'Piso altitudinal', def: 'Franja ecológica según altitud (Costa, Yunga, Quechua, Suni, Puna, Janca, Selva). Aquí se asigna por la altitud de la capital distrital.' },
  { termino: 'DEM', def: 'Modelo Digital de Elevación (Digital Elevation Model): datos de altitud del terreno usados para contextualizar los pisos altitudinales.' },
  { termino: 'IDH', def: 'Índice de Desarrollo Humano (PNUD): combina salud, educación e ingresos en una escala. Aquí se usa como variable de necesidad/contexto.' },
]

interface FaqItem {
  q: string
  a: string
}

const FAQ: FaqItem[] = [
  {
    q: '¿De dónde salen los datos?',
    a: 'Del SIAF-MEF (Sistema Integrado de Administración Financiera) y portales oficiales como Consulta Amigable, INEI, PNUD y MINAM. El detalle exacto de fuentes y endpoints aparece en la introducción de esta página.',
  },
  {
    q: '¿Cada cuánto se actualizan?',
    a: 'Se refrescan periódicamente con cada nuevo corte público del SIAF. La fecha del último corte se muestra arriba (campo "Última actualización"). Como toda fuente pública, puede haber un rezago respecto al día de hoy.',
  },
  {
    q: '¿Por qué las cifras difieren de Consulta Amigable?',
    a: 'Por tres motivos: (1) corte de fecha distinto; (2) nivel de agregación distinto (aquí agrupamos por año, nivel, función o territorio); y (3) criterio de territorialización: parte de la información se atribuye a la ubicación de la unidad ejecutora y no siempre a la ubicación física de la obra.',
  },
  {
    q: '¿Por qué el presupuesto histórico llega solo hasta departamento y no a distrito?',
    a: 'Es un vacío de la propia fuente, no del observatorio. El SIAF del MEF solo georreferencia el gasto a su DESTINO a nivel de departamento (campo DEPARTAMENTO_META); no existe provincia ni distrito de destino. El único nivel distrital disponible es el de la UNIDAD EJECUTORA (dónde está la entidad que administra el gasto), que para el grueso del Gobierno Nacional figura en Lima, no en el territorio donde realmente se invierte. En otras palabras: el Estado peruano no registra públicamente en qué distrito aterriza la mayor parte de su presupuesto. Por eso QHAWAY muestra el detalle por destino a nivel departamental para todos los años (2004-2026), el detalle distrital por ejecutora donde está disponible (2025), y visibiliza explícitamente este vacío de transparencia.',
  },
  {
    q: '¿Qué significa cada fase del gasto?',
    a: 'PIA es lo aprobado al inicio; PIM es el presupuesto modificado vigente; Certificado reserva presupuesto; Comprometido lo obliga contractualmente; Devengado reconoce la obligación al recibir el bien o servicio; y Girado paga. El glosario detalla cada una.',
  },
  {
    q: '¿Uso devengado o girado para medir ejecución?',
    a: 'Por convención usamos el DEVENGADO sobre el PIM como medida principal de ejecución, porque refleja el gasto efectivamente reconocido. El girado va un paso después (el pago) y suele ir muy cerca del devengado.',
  },
  {
    q: '¿Cómo se clasificó el piso altitudinal?',
    a: 'Por la altitud de la CAPITAL del distrito comparada con los rangos de los pisos andinos. Es una aproximación razonable pero imperfecta: un distrito puede abarcar varios pisos y aquí se le asigna solo el dominante.',
  },
  {
    q: '¿Cómo se calcula el IPT y por qué es parcial?',
    a: 'El Índice de Priorización Territorial combina señales de presupuesto, necesidad (pobreza, IDH) y ejecución en un valor comparativo entre territorios. Es PARCIAL porque no incorpora todas las dimensiones del desarrollo ni todos los datos disponibles; sirve para ordenar y contrastar, no como verdad absoluta.',
  },
  {
    q: '¿Las proyecciones e índices predicen el futuro?',
    a: 'No. Todos los índices y comparativos del tablero son COMPARATIVOS y descriptivos, no predicciones. Muestran cómo se ordenan los territorios con la información disponible, no qué ocurrirá.',
  },
  {
    q: '¿Puedo descargar los datos?',
    a: 'Sí. Los datos derivados se publican abiertos bajo licencia Creative Commons CC BY 4.0: puedes reutilizarlos citando la fuente. Las fuentes primarias conservan sus propias condiciones.',
  },
  {
    q: '¿Puedo citarlo en mi tesis?',
    a: 'Sí. Formato sugerido: QHAWAY 2.0 — Observatorio Territorial del Perú, FIEECS-UNI (2026). Datos: SIAF-MEF y fuentes oficiales. Recuperado de qhaway-dashboard. Incluye la fecha de consulta.',
  },
  {
    q: '¿Funciona en móvil y sin registrarme?',
    a: 'Sí. Es un tablero abierto, sin login ni registro, diseñado mobile-first: puedes consultarlo desde el celular tocando los gráficos para ver los tooltips.',
  },
  {
    q: '¿Cómo reporto un error?',
    a: 'Abre un issue en el repositorio del proyecto en GitHub describiendo el dato, la página y, si puedes, una captura. Lo revisaremos y corregiremos en el siguiente corte.',
  },
]

const LIMITACIONES: string[] = [
  'El análisis de riesgo está a nivel departamental, no distrital: no desagregamos riesgo por cada distrito.',
  'El piso altitudinal indica el piso dominante (por la capital), no la composición porcentual de pisos dentro del distrito.',
  'El IPT es un índice parcial: no cubre todas las dimensiones del desarrollo ni todas las fuentes posibles.',
  'La territorialización equipara, en parte, "territorio" con la ubicación de la unidad ejecutora, no siempre con la ubicación física de la obra o servicio.',
  'Los montos están en soles corrientes, sin ajuste por inflación.',
  'Es un MVP: la cobertura de años, funciones y pliegos puede crecer en versiones futuras.',
]

export default function Metodologia() {
  const { data: meta, loading, error } = useAsync(() => getMeta(), [])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  if (!meta) return <Loading />

  const aniosCubiertos =
    meta.years.length > 0
      ? `${Math.min(...meta.years)}–${Math.max(...meta.years)}`
      : '—'

  return (
    <div className="space-y-8">
      {/* 1. INTRO */}
      <SectionIntro title="Metodología, guía de lectura y preguntas frecuentes">
        QHAWAY 2.0 es el <strong>Observatorio Territorial del Perú</strong> de la
        FIEECS-UNI: un tablero abierto que visualiza el presupuesto público y su
        ejecución en el territorio, con datos del <strong>SIAF-MEF</strong> y otras
        fuentes oficiales. Esta página explica cómo leer cada gráfico, define los
        términos presupuestales y responde las dudas más comunes, con un criterio
        explícito anti-sobreinterpretación.
      </SectionIntro>

      {/* Presentación QHAWAY 2.0 */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-brand-500/10 to-gold-400/10 px-5 sm:px-7 py-6 border-b border-ink-200 dark:border-ink-800">
          <h2 className="text-xl font-bold text-ink-900 dark:text-ink-50">QHAWAY 2.0: El Observatorio Territorial del Perú</h2>
          <p className="text-sm text-brand-700 dark:text-brand-300 mt-1">FIEECS — Universidad Nacional de Ingeniería</p>
        </div>
        <div className="px-5 sm:px-7 py-6 space-y-4 text-[15px] leading-relaxed text-ink-600 dark:text-ink-200 max-w-3xl">
          <p>
            <strong className="text-ink-900 dark:text-ink-50">QHAWAY significa mirar.</strong> Pero no
            cualquier mirada. Es la mirada larga de los pueblos que observan la montaña, el río, el bosque,
            el mar y la chacra para comprender los signos de la vida. Es también la mirada que interroga al
            poder y pregunta dónde están puestas las manos del Estado, a quién alimentan sus decisiones y qué
            futuros construyen sus presupuestos.
          </p>
          <p>
            QHAWAY 2.0 es el <strong className="text-ink-900 dark:text-ink-50">Observatorio Territorial del
            Perú</strong> de la FIEECS-UNI, un espacio abierto de lectura, análisis y democratización de la
            información pública. A partir de los datos del presupuesto público, su ejecución territorial y
            diversas fuentes oficiales, el observatorio permite seguir el rastro de los recursos del Estado en
            los territorios y comprender cómo estos se traducen —o no— en bienestar, conservación,
            infraestructura, derechos, naturaleza y oportunidades para las personas, sus territorios y sus
            vidas en desarrollo.
          </p>
          <p>
            Creemos que el presupuesto es mucho más que una cifra. Es una declaración política sobre aquello
            que una sociedad decide cuidar. Allí donde se asignan recursos se revelan prioridades; allí donde
            no llegan, también se expresan silencios, ausencias y desigualdades. Por ello, QHAWAY busca hacer
            visible aquello que suele permanecer oculto tras tablas, códigos y reportes técnicos: las huellas
            concretas de las decisiones públicas sobre la vida cotidiana de las personas y los territorios.
          </p>
          <p>
            Inspirado en las tradiciones de pensamiento crítico del Perú, este observatorio entiende que los
            territorios no son espacios vacíos ni simples divisiones administrativas. Son geografías vivas
            donde conviven memorias, economías, culturas, ecosistemas y proyectos colectivos. Desde esta
            perspectiva, los datos públicos dejan de ser patrimonio exclusivo de especialistas para
            convertirse en herramientas de reflexión y acción ciudadana.
          </p>
          <p>
            QHAWAY 2.0 ha sido concebido para servir a comunidades locales, gobiernos subnacionales,
            organizaciones sociales, investigadores e investigadoras, estudiantes y ciudadanía en general. Su
            propósito es facilitar una lectura accesible y rigurosa del presupuesto público, fortaleciendo la
            capacidad de los territorios para comprender las decisiones estatales, dialogar con ellas y
            participar informadamente en la construcción de su propio desarrollo.
          </p>
          <p>
            Esta página explica cómo interpretar cada gráfico y visualización, define los principales conceptos
            presupuestales y responde las preguntas más frecuentes. Asimismo, incorpora un criterio explícito
            de <strong className="text-ink-900 dark:text-ink-50">prudencia analítica</strong>: los datos
            permiten observar tendencias y patrones, pero no deben ser utilizados para realizar conclusiones
            apresuradas o interpretaciones que excedan la evidencia disponible.
          </p>
          <p className="text-ink-500 dark:text-ink-400 italic border-l-2 border-brand-500 pl-4">
            Porque observar también es un acto de ciudadanía. Porque los territorios tienen derecho a conocer
            cómo se decide sobre su presente y su futuro. Y porque, al seguir el camino del presupuesto,
            podemos reconocer con mayor claridad hacia dónde se orientan las manos del Estado y qué formas de
            vida están siendo sostenidas, protegidas o postergadas.
          </p>
        </div>
      </Card>

      {/* Ficha de datos */}
      <Card>
        <CardHeader
          title="Origen y vigencia de los datos"
          subtitle="Qué cubre el observatorio y cuándo se actualizó por última vez"
          help={
            <HelpTip>
              Este recuadro resume el alcance del tablero: años cubiertos, fecha del
              último corte oficial y notas metodológicas declaradas en los metadatos.
            </HelpTip>
          }
          right={<Pill tone="brand">CC BY 4.0</Pill>}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-black/5 dark:border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide opacity-60">
              Años cubiertos
            </div>
            <div className="text-lg font-semibold">{aniosCubiertos}</div>
            <div className="mt-1 text-sm opacity-70">
              Año más reciente: {meta.latestYear}
            </div>
          </div>
          <div className="rounded-lg border border-black/5 dark:border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide opacity-60">
              Última actualización
            </div>
            <div className="text-lg font-semibold">{meta.lastUpdate}</div>
            <div className="mt-1 text-sm opacity-70">
              Fases disponibles: {meta.fases.join(' · ')}
            </div>
          </div>
        </div>

        {meta.notas && (
          <div className="mt-4 rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <Pill tone="warn">nota metodológica</Pill>
            </div>
            <p className="opacity-90">{meta.notas}</p>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-2 text-sm font-medium opacity-80">Fuentes</div>
          <ul className="space-y-1 text-sm">
            {meta.sources.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center gap-2">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 underline decoration-dotted hover:opacity-80"
                >
                  {s.name}
                </a>
                {s.endpoint && (
                  <span className="text-xs opacity-50">({s.endpoint})</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {meta.parcial && Object.keys(meta.parcial).length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium opacity-80">
              Coberturas parciales <Pill tone="warn">aprox.</Pill>
            </div>
            <ul className="space-y-1 text-sm opacity-90">
              {Object.entries(meta.parcial).map(([k, v]) => (
                <li key={k}>
                  <span className="font-medium">{k}:</span> {v}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* 2. CÓMO LEER LOS GRÁFICOS */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Cómo leer los gráficos</h2>
        <p className="text-sm opacity-70">
          Cada tipo de visualización comunica algo distinto. Aquí va, por tipo, qué
          significa y cómo evitar malinterpretarlo.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {GUIA_GRAFICOS.map((g) => (
            <Card key={g.nombre}>
              <CardHeader
                title={`${g.icono}  ${g.nombre}`}
                help={
                  <HelpTip>
                    Cómo leerlo: {g.como} Cuidado: {g.cuidado}
                  </HelpTip>
                }
              />
              <p className="text-sm opacity-90">{g.como}</p>
              <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm">
                <span className="mr-2 align-middle">
                  <Pill tone="warn">cuidado</Pill>
                </span>
                <span className="opacity-90">{g.cuidado}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* 3. GLOSARIO */}
      <Card>
        <CardHeader
          title="Glosario presupuestal"
          subtitle="Términos clave del ciclo del gasto público y de la georreferenciación"
          help={
            <HelpTip>
              Define cada término que aparece en el tablero. Las fases del gasto van
              en orden: PIA → PIM → Certificado → Comprometido → Devengado → Girado.
            </HelpTip>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-black/10 dark:border-white/10">
                <th className="py-2 pr-4 font-medium whitespace-nowrap">Término</th>
                <th className="py-2 font-medium">Definición</th>
              </tr>
            </thead>
            <tbody>
              {GLOSARIO.map((t) => (
                <tr
                  key={t.termino}
                  className="border-b border-black/5 dark:border-white/5 align-top"
                >
                  <td className="py-2 pr-4 font-semibold whitespace-nowrap">
                    {t.termino}
                  </td>
                  <td className="py-2 opacity-90">{t.def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 4. FAQ */}
      <Card>
        <CardHeader
          title="Preguntas frecuentes"
          subtitle="Toca cada pregunta para desplegar la respuesta"
          help={
            <HelpTip>
              Respuestas breves a las dudas más comunes sobre origen, actualización,
              diferencias con Consulta Amigable, fases, IPT, descargas y citación.
            </HelpTip>
          }
        />
        <div className="space-y-2">
          {FAQ.map((f) => (
            <details
              key={f.q}
              className="group rounded-lg border border-black/10 dark:border-white/10 p-3"
            >
              <summary className="cursor-pointer list-none font-medium flex items-center justify-between gap-3">
                <span>{f.q}</span>
                <span className="opacity-50 transition-transform group-open:rotate-90">
                  ▸
                </span>
              </summary>
              <p className="mt-2 text-sm opacity-90">{f.a}</p>
            </details>
          ))}
        </div>
      </Card>

      {/* 5. LIMITACIONES */}
      <Card>
        <CardHeader
          title="Limitaciones y honestidad metodológica"
          subtitle="Lo que este MVP todavía NO hace — para no sobreinterpretar"
          help={
            <HelpTip>
              Declaramos explícitamente los límites del tablero. Leer los datos con
              estos límites en mente evita conclusiones que la información no sostiene.
            </HelpTip>
          }
          right={<Pill tone="warn">anti-overclaiming</Pill>}
        />
        <ul className="space-y-2 text-sm">
          {LIMITACIONES.map((l) => (
            <li key={l} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">
                <Pill tone="warn">límite</Pill>
              </span>
              <span className="opacity-90">{l}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 6. CRÉDITOS Y FUENTES */}
      <Card>
        <CardHeader
          title="Créditos, licencia y fuentes"
          subtitle="Cómo citar el observatorio y dónde están las fuentes oficiales"
          help={
            <HelpTip>
              Datos derivados bajo licencia CC BY 4.0. Las fuentes primarias conservan
              sus propias condiciones de uso. Reporta errores en el repositorio.
            </HelpTip>
          }
        />
        <div className="space-y-4 text-sm">
          <p className="opacity-90">
            <strong>QHAWAY 2.0 — Observatorio Territorial del Perú.</strong> Proyecto
            de la FIEECS-UNI. Datos del SIAF-MEF y fuentes oficiales. Datos derivados
            bajo licencia <Pill tone="brand">CC BY 4.0</Pill>.
          </p>

          <div>
            <div className="mb-1 font-medium opacity-80">Cita sugerida</div>
            <p className="rounded-lg bg-black/5 dark:bg-white/5 p-3 font-mono text-xs leading-relaxed">
              QHAWAY 2.0 — Observatorio Territorial del Perú, FIEECS-UNI (2026).
              Datos: SIAF-MEF y fuentes oficiales. Última actualización:{' '}
              {meta.lastUpdate}. Recuperado de qhaway-dashboard.
            </p>
          </div>

          <div>
            <div className="mb-1 font-medium opacity-80">Fuentes oficiales</div>
            <ul className="space-y-1">
              {meta.sources.map((s) => (
                <li key={s.name}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 underline decoration-dotted hover:opacity-80"
                  >
                    {s.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1 font-medium opacity-80">Reportar un error</div>
            <a
              href={GITHUB_ISSUES}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 underline decoration-dotted hover:opacity-80"
            >
              Abrir un issue en GitHub
            </a>
          </div>
        </div>
      </Card>
    </div>
  )
}
