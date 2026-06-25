import { SectionIntro } from '../components/ui'
import ClimaOficial from '../components/ClimaOficial'

/* ════════════════════════════════════════════════════════════════════
 * Cambio Climático — ahora sólo el DATO OFICIAL del clasificador temático
 * del MEF (adaptación/mitigación × directa/indirecta), cortable por
 * Función, Departamento (territorialidad) y Categoría/Programa presupuestal.
 *
 * Se retiró el antiguo proxy por «función AMBIENTE» (componentes
 * ClimaProgramas/ClimaTerritorio y el desglose inline por función «Solo
 * Ambiente»): el clasificador oficial ya desglosa por función, por lo que
 * el proxy era redundante y confundía. Los componentes proxy siguen en el
 * repo pero ya no se renderizan aquí.
 * ════════════════════════════════════════════════════════════════════ */

export default function Clima() {
  return (
    <div className="space-y-6">
      <SectionIntro title="Cambio Climático">
        <p>
          ¿Cuánto, dónde y en qué invierte el Perú frente al cambio climático? Esta vista usa el{' '}
          <b>dato oficial</b>: el <b>clasificador temático del MEF</b> (adaptación / mitigación ×
          directa / indirecta), que reemplaza al antiguo proxy de la «función Ambiente». Puedes
          cortarlo por <b>Función</b>, por <b>Departamento</b> (territorialidad) o por{' '}
          <b>Categoría / Programa presupuestal</b> climático.
        </p>
      </SectionIntro>

      <ClimaOficial />
    </div>
  )
}
