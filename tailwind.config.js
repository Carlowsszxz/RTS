/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        neo: {
          canvas: 'rgb(var(--neo-canvas) / <alpha-value>)',
          ink: 'rgb(var(--neo-ink) / <alpha-value>)',
          accent: 'rgb(var(--neo-accent) / <alpha-value>)',
          secondary: 'rgb(var(--neo-secondary) / <alpha-value>)',
          muted: 'rgb(var(--neo-muted) / <alpha-value>)',
        },
      },
      boxShadow: {
        'neo-sm': '4px 4px 0px 0px #000',
        'neo-md': '8px 8px 0px 0px #000',
        'neo-lg': '12px 12px 0px 0px #000',
        'neo-xl': '16px 16px 0px 0px #000',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'sans-serif'],
      },
      keyframes: {
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'spin-slow': 'spin-slow 10s linear infinite',
      },
    },
  },
  plugins: [],
}

