# Hoja de API compartida — qhaway-dashboard (LEER ANTES DE ESCRIBIR PÁGINAS)

Stack: React 18 + TypeScript + Vite + Tailwind 3 (darkMode 'class') + ECharts (echarts-for-react) + Leaflet. Router = HashRouter. NO usar otras librerías (no recharts, no d3, no shadcn). Español (Perú).

Las páginas viven en `src/pages/*.tsx` y exportan `export default function NombrePagina()`.

## Imports disponibles y sus firmas EXACTAS

### Datos — `../lib/data`
```ts
getMeta(): Promise<Meta>
getSerieNacional(): Promise<SerieNacional[]>
getPorNivel(): Promise<PorNivel[]>
getPorDepartamento(): Promise<PorDepartamento[]>
getPorDistrito(year: number): Promise<PorDistrito[]>
getPorFuncion(year: number): Promise<PorFuncion[]>
getPorSector(year: number): Promise<PorSector[]>
getFlujoFases(year: number): Promise<FlujoFases>
getAltitudes(): Promise<AltitudDistrito[]>
getGeoJSON(): Promise<any>   // FeatureCollection; cada feature.properties: { IDDIST, NOMBDIST, NOMBPROV, NOMBDEP, NOM_CAP, IDDPTO, IDPROV, AREA_MINAM }
loadJSON<T>(path: string): Promise<T>   // path relativo a public/data/. Ej: loadJSON<Indicador[]>('indicadores-distrito.json')
```

### Tipos — `../lib/types`
```ts
type Fase = 'pia'|'pim'|'certificado'|'devengado'|'girado'
Meta { years:number[]; latestYear:number; lastUpdate:string; fases:Fase[]; sources:{name,url,endpoint?}[]; notas:string; parcial?:Record<string,string>; resourceIds?:Record<string,string> }
SerieNacional { year, pia, pim, certificado?, devengado, girado }   // montos en soles (number)
PorNivel { year, nivel, pia, pim, devengado, girado }               // nivel: 'GOBIERNO NACIONAL'|'GOBIERNO REGIONAL'|'GOBIERNO LOCAL'
PorDepartamento { year, ubigeo(2díg), departamento, nivel, pia, pim, devengado, girado }
PorDistrito { ubigeo(6díg), departamento, provincia, distrito, nivel, pia, pim, devengado, girado }
PorFuncion { funcion, pim, devengado, girado }
PorSector { sector, pim, devengado }
FlujoFases { pia, pim, certificado?, devengado, girado }
AltitudDistrito { ubigeo, altitud }
```
NOTA: el join mapa↔presupuesto es por ubigeo de 6 dígitos = `feature.properties.IDDIST` === `PorDistrito.ubigeo`. Para departamento, `feature.properties.IDDPTO` (2díg) === `PorDepartamento.ubigeo`.

`indicadores-distrito.json` (cargar con `loadJSON<IndicadorDistrito[]>('indicadores-distrito.json')`):
```ts
IndicadorDistrito { ubigeo:string; pob:number; idh:number; pobreza:number; pobrezaExt:number; vulnAlim:number; altitud:number }
// REALES (PNUD 2019 / INEI): idh (0-100), pobreza (% monetaria), pobrezaExt (%), vulnAlim, altitud (msnm). 1894 distritos.
```

`riesgos.json` (cargar con `loadJSON<RiesgosData>('riesgos.json')`):
```ts
RiesgosData {
  lastUpdate:string
  regions: { id, name, zona:'Costa'|'Sierra'|'Selva', ciudad, lat, lon, pob, ubigeo(2díg), risks:Record<string,'alta'|'media'|'baja'> }[]
  riskLabels: Record<string,string>   // ej. { sismo:'Sismos', huaicos:'Huaicos / inundaciones', ... }
  context: {
    sismosHistoricos:{anio,nombre,mag,muertos}[]
    ninoEventos:{anio,intensidad}[]
    glaciaresKm2:{labels:number[],km2:number[]}
    deforestacion2023:{region,ha}[]
    damnificadosPorAnio:{anio,cifra}[]
  }
  fuentes:{name,url}[]
}
```

### Pisos altitudinales — `../lib/pisos`
```ts
PISOS: Piso[]            // 6 pisos andinos costa→cordillera
TODOS_PISOS: Piso[]      // incluye Selva Alta y Selva Baja (8 en total)
PISO_SELVA_ALTA, PISO_SELVA_BAJA: Piso
clasificarPiso(altitud:number|undefined, departamento:string): Piso | null
interface Piso { id, nombre, quechua?, min, max, color, desc }
```

### Formato — `../lib/format`
```ts
soles(v): string          // 'S/ 1,234,567'
solesCompact(v): string   // 'S/ 1.2 mil M' | 'S/ 345.6 M' | 'S/ 12.3 k'
num(v): string            // '1,234'
pct(v, digits=1): string  // v es fracción 0..1 -> '78.4%'
ejecucion(dev, pim): number  // fracción 0..1
```

### Hook — `../lib/useAsync`
```ts
useAsync<T>(fn: () => Promise<T>, deps?: unknown[]): { data?: T; loading: boolean; error?: string }
```

### UI — `../components/ui`
```tsx
<Card className?> ...children </Card>
<CardHeader title subtitle? help?={ReactNode} right?={ReactNode} />
<HelpTip>{texto explicativo}</HelpTip>     // ícono (i) con tooltip — ÚSALO para explicar cada gráfico
<KPI label value sub? accent? />
<Pill tone?='neutral'|'warn'|'good'|'brand'>texto</Pill>
<Select value onChange options={ {value,label}[] } label? />   // genérico <T extends string|number>
<Loading label? />
<ErrorBox error={string} />
<SectionIntro title>{descripción}</SectionIntro>
```

### Charts — `../components/Chart`
```tsx
import { Chart, PALETA } from '../components/Chart'
<Chart option={EChartsOption} height?={number} onEvents?={Record<string,(p)=>void>} />
// Chart YA aplica color, grid, tooltip y dark mode. Solo pasa series/xAxis/yAxis/visualMap/etc.
// PALETA: string[] de 10 colores de marca.
```

### Mapa distrital — `../components/MapaDistrital`
```tsx
import MapaDistrital, { MapValue } from '../components/MapaDistrital'
<MapaDistrital
  geojson={geo}                         // de getGeoJSON()
  values={Map<string /*ubigeo6*/, {value:number,label?:string,color?:string}>}
  unitLabel?="PIM" formatValue?={(v)=>solesCompact(v)}
  max?={number} colorScale?={(v,max)=>string}
  onSelect?={(ubigeo,name)=>void} selected?={ubigeo} height?={520}
/>
// Para colorear por departamento: asigna a TODOS los distritos de un depto el mismo value/color.
// El ubigeo de distrito es feature.properties.IDDIST; su depto es los 2 primeros dígitos.
```

### Tema — `../lib/theme`
```ts
useTheme(): { theme:'light'|'dark'; toggle:()=>void }
```

## Reglas de UI
- Mobile-first. Grids: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`.
- Cada gráfico va dentro de `<Card>` con `<CardHeader title ... help={...}>` y un `<HelpTip>` que explique CÓMO leerlo y CÓMO no malinterpretarlo (tooltips, ejes, qué significa cada color).
- Manejo de estados: usa `useAsync`; si `loading` → `<Loading/>`; si `error` → `<ErrorBox error={error}/>`; si `!data` → `<Loading/>`.
- Anti-overclaiming: marca con `<Pill tone="warn">aprox.</Pill>` o nota lo que sea estimación/metodológico (ej. piso por altitud de capital, IPT parcial). Distingue dato REAL vs supuesto.
- Colores de ejecución: usa rojo/ámbar/verde para % de ejecución (devengado/pim): <0.5 rojo, 0.5–0.8 ámbar, >0.8 verde.
- Tooltips ECharts: incluye nombre + valor en soles compactos.
- Texto en español, cifras con `soles`/`solesCompact`/`pct`/`num`.
- NO inventes datos en el componente; todo viene de los loaders. Si un archivo de presupuesto aún no existe, el ErrorBox lo cubre.
