import { defineConfig, presetUno, presetAttributify, presetIcons } from 'unocss';

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      extraProperties: {
        display: 'inline-block',
        'vertical-align': 'middle',
      },
    }),
  ],
  shortcuts: {
    'flex-center': 'flex items-center justify-center',
    'flex-between': 'flex items-center justify-between',
    'btn': 'px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600 cursor-pointer',
    'btn-ghost': 'px-4 py-2 rounded border border-gray-300 hover:bg-gray-50 cursor-pointer',
  },
});
