// dsh-typwriter 浏览器半片：注册左上角入口 + 主区整页。
// 主区用一个同源 iframe 装载 Texpile 的渲染端 SPA（/typwriter/），
// 这样 Texpile 的 Tailwind/全局 CSS 不会污染 DSH 主题，也不需要跨框架桥接。
const React = require('react');

const KEY = 'typwriter';
// 带 #/workspace：DSH 切换面板会卸载重挂 iframe，src 无 hash 时新文档落在启动屏一瞬
const SRC = '/typwriter/#/workspace';

// 统一品牌形象（精简线条版，与管理页 icon.svg 同一设计语言）：一张纸、几行字、一支斜放的笔。
// currentColor 线条随 DSH 主题着色；右下角叠「Typ」小字角标。
function Icon({ size }) {
  const s = size || 18;
  return React.createElement(
    'span',
    { style: { position: 'relative', display: 'inline-block', width: s, height: s, lineHeight: 0 }, 'aria-hidden': true },
    React.createElement(
      'svg',
      {
        width: s,
        height: s,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
      },
      // 纸（右上折角）
      React.createElement('path', { d: 'M4.5 3.5h9l3 3v13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z' }),
      React.createElement('path', { d: 'M13.5 3.5V7h3' }),
      // 文字行
      React.createElement('path', { d: 'M7 10.5h6.5M7 13.5h4.5' }),
      // 笔：斜放右下，笔尖朝纸
      React.createElement('path', { d: 'M17.5 13.5l3 3-4.5 4.5H13v-3z' })
    ),
    React.createElement(
      'span',
      {
        style: {
          position: 'absolute',
          right: -2,
          bottom: -2,
          fontSize: Math.max(7, Math.round(s * 0.42)),
          fontWeight: 700,
          color: '#fff',
          background: '#1f2430',
          borderRadius: 3,
          padding: '0 2px',
          lineHeight: 1.15,
          letterSpacing: '0.02em',
          boxShadow: '0 0 0 1px rgba(255,255,255,.55)'
        }
      },
      'Typ'
    )
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
