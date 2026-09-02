/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        kairo: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
        sidebar: {
          DEFAULT: '#0c1222',
          light: '#151d32',
          border: 'rgba(255,255,255,0.08)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.06)',
        elevated: '0 10px 40px -12px rgb(15 23 42 / 0.18)',
      },
      backgroundImage: {
        'kairo-mesh': 'radial-gradient(at 40% 20%, rgb(45 212 191 / 0.14) 0px, transparent 50%), radial-gradient(at 80% 0%, rgb(56 189 248 / 0.12) 0px, transparent 50%), radial-gradient(at 0% 50%, rgb(20 184 166 / 0.08) 0px, transparent 50%)',
      },
      padding: {
        safe: 'env(safe-area-inset-bottom, 0px)',
        'safe-top': 'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-left': 'env(safe-area-inset-left, 0px)',
        'safe-right': 'env(safe-area-inset-right, 0px)',
      },
    },
  },
  plugins: [],
  safelist: ['lg:ml-72', 'lg:ml-0'],
};
