import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Paleta neutra estilo Tabler (el acento de marca sigue siendo cielo.navy)
        tabler: {
          bg:    '#f6f8fb',
          line:  '#e6e7e9',
          ink:   '#182433',
          mute:  '#667382',
          green: '#2fb344',
          red:   '#d63939',
          amber: '#f59f00',
          azure: '#4299e1',
        },
        // Cielo Cloud brand
        cielo: {
          navy:  '#1B2980',
          green: '#00E676',
          50:    '#eef0fb',
          100:   '#d5d9f4',
          200:   '#aab4ea',
          700:   '#1B2980',
          800:   '#151f66',
          900:   '#0d1449',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateY(-4px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
