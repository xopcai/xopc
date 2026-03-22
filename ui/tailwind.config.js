/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ui: {
          app: 'var(--app-bg)',
          card: 'var(--card-bg)',
          hover: 'var(--hover-bg)',
          border: 'var(--border-default)',
          'border-subtle': 'var(--border-subtle)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          disabled: 'var(--text-disabled)',
          foreground: 'var(--text-primary)',
          muted: 'var(--text-secondary)',
        },
        background: 'var(--app-bg)',
        foreground: 'var(--text-primary)',
        muted: {
          DEFAULT: 'var(--hover-bg)',
          foreground: 'var(--text-secondary)',
        },
        card: {
          DEFAULT: 'var(--card-bg)',
          foreground: 'var(--text-primary)',
        },
        destructive: {
          DEFAULT: 'var(--error)',
          foreground: 'white',
        },
        border: 'var(--border-default)',
        input: 'var(--hover-bg)',
        primary: {
          DEFAULT: 'var(--primary-base)',
          foreground: 'white',
          light: 'var(--primary-soft)',
        },
        secondary: {
          DEFAULT: 'var(--hover-bg)',
          foreground: 'var(--text-primary)',
        },
        accent: {
          DEFAULT: 'var(--hover-bg)',
          foreground: 'var(--text-primary)',
        },
        brand: {
          DEFAULT: 'var(--primary-base)',
          base: 'var(--primary-base)',
          hover: 'var(--primary-hover)',
          soft: 'var(--primary-soft)',
        },
        semantic: {
          success: 'var(--success)',
          'success-bg': 'var(--success-soft)',
          error: 'var(--error)',
          'error-bg': 'var(--error-soft)',
          warning: 'var(--warning)',
          'warning-bg': 'var(--warning-soft)',
        }
      },
      borderRadius: {
        'button': '0.75rem',  // 12px (同 rounded-xl)
        'card': '1rem',       // 16px (同 rounded-2xl)
        'modal': '1.5rem',    // 24px (同 rounded-3xl)
      },
      boxShadow: {
        'soft-xl': '0 20px 25px -5px var(--shadow-color)',
        'popover': '0 20px 25px -5px var(--shadow-color)',
        'modal': '0 25px 50px -12px var(--shadow-color)',
      },
      transitionTimingFunction: {
        'apple-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      }
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.focus-ring': {
          '@apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ui-app': {},
        },
        '.active-scale': {
          '@apply active:scale-95 transition-all duration-200 ease-apple-ease': {},
        },
        '.hover-float': {
          '@apply hover:-translate-y-0.5 transition-all duration-200 ease-apple-ease': {},
        }
      });
    },
  ],
}
