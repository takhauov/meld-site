/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/layout.html', './src/pages/**/*.html'],
  // 'flex-[3]' переключается через JS (см. highlightThumb в layout.html) и по
  // не выясненной причине не попадает в сборку при автосканировании —
  // включаем явно, чтобы расширение активной миниатюры в галерее не пропало.
  safelist: ['flex-[3]'],
  theme: {
    extend: {
      colors: {
        ink:      '#0D1117',
        surface:  '#161B22',
        teal:     '#14A098',
        tealdeep: '#0E7C7B',
        signal:   '#E23E3E',
        onink:    '#F5F5F5',
        paper:    '#F7F8F9',
        onpaper:  '#0F172A',
        muted:    '#475569',
        line:     '#E2E8F0'
      },
      fontFamily: {
        sans: ['Onest', 'system-ui', 'sans-serif']
      },
      borderRadius: { DEFAULT: '3px', md: '4px', lg: '6px' },
      maxWidth: { prose: '64ch' }
    }
  },
  plugins: []
};
