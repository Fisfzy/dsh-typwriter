// dsh-typwriter 浏览器半片：注册左上角入口 + 主区整页。
// 主区用一个同源 iframe 装载 Texpile 的渲染端 SPA（/typwriter/），
// 这样 Texpile 的 Tailwind/全局 CSS 不会污染 DSH 主题，也不需要跨框架桥接。
const React = require('react');

const KEY = 'typwriter';
const SRC = '/typwriter/';

// 统一品牌形象：图标 PNG（26×33）内嵌，右下角叠「Typ」小字角标
const ICON_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAhCAYAAADH97ugAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAGdYAABnWARjRyu0AAAICSURBVEhL7ZNPSJNxGMc/7+uWYGx5LWWTXpgoHgbvgl6dnUK3rgVJVAw81CFl1HAjyMuKLp66FCF5snbYtUsW9odlpUXQJaHVkohtXZyDQDezgzl6f/a+s1d7D+Hn9PJ9nocP7/M+r6Qoyho2IIvBv8I2kaSqqi2rkzRNs0f06UvRFpFt32hXZBnbRHWvrpAvMv34CaVSSSzpkGWZrq5ONO2wWIJ6okxmhtHRJKurVbFkSCjURyIRE2Nz0cmB0xTyRQD2tbYhORxiC4u5D2JEIh4jFO7TZZsnf/F+fr4maQ304u0+ysr3MgDNHoUf1SpLXz/j3u/hUXJYNzs392aTyPAYKsuV2nOjq5n8u1fMjo8xOz7GQmaKhcxD3k7eZE/TXgACqp/o8Pn12cpKbXYDQ5EZy+Uyvv7jBKNJJKeTgOonnZogOnSOUwMnxHawKso9n+L+yFmmr1+kzeXgzu0bAFy+co27qbTYDlZFGwRUPxd6fbjdLlMJ2xEdG7lKOjVBk7OhroTtiLyHjvCgsMbk61xdCVZFkiTR+Owet4YiPM1+E8t/xPCHzWY/Mji4fq5/SzjcTzx+SZcZvpGiHKS93SfGWyIY7BYjYxFALBbF6/WIsSmRyBl6ejQxNl7d78y8eElpcUmMdTQ4ZDo7OmhpOSCWYKuincB0dTvJrsgy/5/oJ0JVoceVSevUAAAAAElFTkSuQmCC';

function Icon({ size }) {
  const s = size || 18;
  const h = Math.round((s * 33) / 26);
  return React.createElement(
    'span',
    { style: { position: 'relative', display: 'inline-block', width: s, height: h, lineHeight: 0 }, 'aria-hidden': true },
    React.createElement('img', { src: ICON_PNG, width: s, height: h, alt: '', style: { display: 'block' } }),
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
