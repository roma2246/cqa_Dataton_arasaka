/** Цвета — семантические токены из src/index.css; тёмная тема меняет только токены. */
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
const pair = (n) => ({ DEFAULT: v(n), weak: v(`${n}-weak`) });

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2'), 3: v('surface-3') },
        fg: { DEFAULT: v('fg'), 2: v('fg-2'), 3: v('fg-3') },
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        accent: { DEFAULT: v('accent'), hover: v('accent-hover'), weak: v('accent-weak'), fg: v('accent-fg') },
        ok: pair('ok'),
        warn: pair('warn'),
        bad: pair('bad'),
        na: pair('na'),
        client: pair('client'),
        bot: pair('bot'),
        sys: pair('sys'),
        hl: v('hl'),
        side: { DEFAULT: v('side'), 2: v('side-2'), fg: v('side-fg'), muted: v('side-muted') },
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)',
        pop: '0 16px 40px -8px rgb(16 24 40 / 0.22)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        pulse_hl: { '0%': { boxShadow: '0 0 0 0 rgb(var(--hl) / 0.7)' }, '100%': { boxShadow: '0 0 0 10px rgb(var(--hl) / 0)' } },
      },
      animation: { 'fade-in': 'fade-in .18s ease-out', 'pulse-hl': 'pulse_hl 1s ease-out 2' },
    },
  },
  plugins: [],
};
