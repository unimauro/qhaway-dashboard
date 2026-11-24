/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          300: '#5eead4',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          900: '#134e4a',
        },
        gold: {
          400: '#fbbf24',
          600: '#d97706',
        },
        // Escala neutra basada en Tailwind `slate` (100/300/500/700 se usaban ~130 veces
        // sin estar definidos → Tailwind no generaba esas clases).
        ink: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          // ink-400 es el gris de texto secundario y se usa SIN variante dark en ~100 sitios.
          // #94a3b8 sobre blanco da 2.56:1 (falla WCAG AA). Ningún tono único cumple AA a la
          // vez sobre blanco y sobre ink-900, así que depende del tema (variable CSS):
          //   claro  → #64748b (slate-500): 4.76:1 sobre blanco, 4.55:1 sobre ink-50
          //   oscuro → #94a3b8 (slate-400): 6.96:1 sobre ink-900
          400: 'rgb(var(--qh-ink-400) / <alpha-value>)',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#0b1120',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [
    // Valores del tono ink-400 según tema (ver comentario en `colors.ink`).
    function ({ addBase }) {
      addBase({
        ':root': { '--qh-ink-400': '100 116 139' },
        '.dark': { '--qh-ink-400': '148 163 184' },
      })
    },
  ],
}
