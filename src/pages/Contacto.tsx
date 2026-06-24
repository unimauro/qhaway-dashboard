import Buzon from '../components/Buzon'
import { SectionIntro } from '../components/ui'

export default function Contacto() {
  return (
    <div className="space-y-6">
      <SectionIntro title="Contacto · Escríbenos al observatorio">
        ¿Tienes una consulta, una sugerencia, un dato para sumar o una propuesta de
        colaboración? El equipo de QHAWAY (FIEECS-UNI) lee cada mensaje. Tu correo viaja por
        el propio servidor del observatorio, <strong>sin servicios de terceros ni rastreo</strong>.
      </SectionIntro>
      <Buzon />
      <p className="text-center text-xs text-ink-400">
        ¿Eres del equipo del observatorio?{' '}
        <a href="#/mensajes" className="text-brand-600 hover:underline">
          Ver los mensajes recibidos →
        </a>
      </p>
    </div>
  )
}
