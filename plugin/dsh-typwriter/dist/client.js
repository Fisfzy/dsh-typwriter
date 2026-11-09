window.__ModuleLoader__.load({id:"dsh-typwriter",factory:(require)=>{const module={exports:{}};const exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var React = require("react");
var KEY = "typwriter";
var SRC = "/typwriter/";
var ICON_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAhCAYAAADH97ugAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAGdYAABnWARjRyu0AAAICSURBVEhL7ZNPSJNxGMc/7+uWYGx5LWWTXpgoHgbvgl6dnUK3rgVJVAw81CFl1HAjyMuKLp66FCF5snbYtUsW9odlpUXQJaHVkohtXZyDQDezgzl6f/a+s1d7D+Hn9PJ9nocP7/M+r6Qoyho2IIvBv8I2kaSqqi2rkzRNs0f06UvRFpFt32hXZBnbRHWvrpAvMv34CaVSSSzpkGWZrq5ONO2wWIJ6okxmhtHRJKurVbFkSCjURyIRE2Nz0cmB0xTyRQD2tbYhORxiC4u5D2JEIh4jFO7TZZsnf/F+fr4maQ304u0+ysr3MgDNHoUf1SpLXz/j3u/hUXJYNzs392aTyPAYKsuV2nOjq5n8u1fMjo8xOz7GQmaKhcxD3k7eZE/TXgACqp/o8Pn12cpKbXYDQ5EZy+Uyvv7jBKNJJKeTgOonnZogOnSOUwMnxHawKso9n+L+yFmmr1+kzeXgzu0bAFy+co27qbTYDlZFGwRUPxd6fbjdLlMJ2xEdG7lKOjVBk7OhroTtiLyHjvCgsMbk61xdCVZFkiTR+Owet4YiPM1+E8t/xPCHzWY/Mji4fq5/SzjcTzx+SZcZvpGiHKS93SfGWyIY7BYjYxFALBbF6/WIsSmRyBl6ejQxNl7d78y8eElpcUmMdTQ4ZDo7OmhpOSCWYKuincB0dTvJrsgy/5/oJ0JVoceVSevUAAAAAElFTkSuQmCC";
function Icon({ size }) {
  const s = size || 18;
  const h = Math.round(s * 33 / 26);
  return React.createElement(
    "span",
    { style: { position: "relative", display: "inline-block", width: s, height: h, lineHeight: 0 }, "aria-hidden": true },
    React.createElement("img", { src: ICON_PNG, width: s, height: h, alt: "", style: { display: "block" } }),
    React.createElement(
      "span",
      {
        style: {
          position: "absolute",
          right: -2,
          bottom: -2,
          fontSize: Math.max(7, Math.round(s * 0.42)),
          fontWeight: 700,
          color: "#fff",
          background: "#1f2430",
          borderRadius: 3,
          padding: "0 2px",
          lineHeight: 1.15,
          letterSpacing: "0.02em",
          boxShadow: "0 0 0 1px rgba(255,255,255,.55)"
        }
      },
      "Typ"
    )
  );
}
function TypwriterPage() {
  return React.createElement("iframe", {
    src: SRC,
    title: "Typwriter",
    // 占满主区；border 去掉，背景跟随主题
    style: {
      width: "100%",
      height: "100%",
      border: "0",
      display: "block",
      background: "transparent"
    },
    // 同源 iframe，允许脚本与同源 cookie
    allow: "clipboard-read; clipboard-write"
  });
}
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject(
    "main",
    () => ctx.slots.register({ name: "main", key: KEY }, TypwriterPage)
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: KEY, order: 6, label: () => "Typst \u5199\u4F5C\u53F0" },
      Icon
    )
  );
}

return module.exports}})
