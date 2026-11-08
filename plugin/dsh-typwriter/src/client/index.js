// dsh-typwriter 浏览器半片：注册左上角入口 + 主区整页。
// 主区用一个同源 iframe 装载 Texpile 的渲染端 SPA（/typwriter/），
// 这样 Texpile 的 Tailwind/全局 CSS 不会污染 DSH 主题，也不需要跨框架桥接。
const React = require('react');

const KEY = 'typwriter';
const SRC = '/typwriter/';

function Icon({ size }) {
  const s = size || 18;
  return React.createElement(
    'svg',
    {
      width: s,
      height: s,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true
    },
    // 一支笔 + 一张纸：写作
    React.createElement('path', { d: 'M4 3.5h9l3 3V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z' }),
    React.createElement('path', { d: 'M13 3.5V7h3' }),
    React.createElement('path', { d: 'M17.5 13.5l3 3-4.5 4.5H13v-3z' })
  );
}

function TypwriterPage() {
  return React.createElement('iframe', {
    src: SRC,
    title: 'Typwriter',
    // 占满主区；border 去掉，背景跟随主题
    style: {
      width: '100%',
      height: '100%',
      border: '0',
      display: 'block',
      background: 'transparent'
    },
    // 同源 iframe，允许脚本与同源 cookie
    allow: 'clipboard-read; clipboard-write'
  });
}

export const inject = ['slots'];

export function apply(ctx) {
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: KEY }, TypwriterPage)
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: KEY, order: 6, label: () => 'Typst 写作台' },
      Icon
    )
  );
}
