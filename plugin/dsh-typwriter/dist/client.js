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
function Icon({ size }) {
  const s = size || 18;
  return React.createElement(
    "span",
    { style: { position: "relative", display: "inline-block", width: s, height: s, lineHeight: 0 }, "aria-hidden": true },
    React.createElement(
      "svg",
      {
        width: s,
        height: s,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round"
      },
      // 纸（右上折角）
      React.createElement("path", { d: "M4.5 3.5h9l3 3v13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" }),
      React.createElement("path", { d: "M13.5 3.5V7h3" }),
      // 文字行
      React.createElement("path", { d: "M7 10.5h6.5M7 13.5h4.5" }),
      // 笔：斜放右下，笔尖朝纸
      React.createElement("path", { d: "M17.5 13.5l3 3-4.5 4.5H13v-3z" })
    ),
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
