window.__ModuleLoader__.load({id:"dsh-typwriter",factory:(require)=>{const module={exports:{}};const exports=module.exports;
// dsh-typwriter 浏览器半片：左上角入口 + 主区整页（同源 iframe 装载 Texpile UI）
var React = require("react");

var KEY = "typwriter";
var SRC = "/typwriter/";

function TypwriterIcon(props) {
  var s = (props && props.size) || 18;
  return React.createElement(
    "svg",
    {
      width: s,
      height: s,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true
    },
    React.createElement("path", { d: "M4 3.5h9l3 3V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" }),
    React.createElement("path", { d: "M13 3.5V7h3" }),
    React.createElement("path", { d: "M17.5 13.5l3 3-4.5 4.5H13v-3z" })
  );
}

function TypwriterPage() {
  return React.createElement("iframe", {
    src: SRC,
    title: "Typst 写作台",
    style: { width: "100%", height: "100%", border: "0", display: "block", background: "transparent" },
    allow: "clipboard-read; clipboard-write"
  });
}

var inject = ["slots"];

function apply(ctx) {
  ctx.slots.inject("main", function () {
    return ctx.slots.register({ name: "main", key: KEY }, TypwriterPage);
  });
  ctx.slots.inject("sidebar.panellist", function () {
    return ctx.slots.register(
      { name: "sidebar.panellist", id: KEY, order: 6, label: function () { return "Typst 写作台"; } },
      TypwriterIcon
    );
  });

  // iframe 里 Texpile 的「返回 DSH」按钮发的消息：把主区切回对话。
  // 惰性取 layout 服务，不用 inject，免得服务缺失导致整个插件不激活。
  if (typeof window !== "undefined") {
    window.addEventListener("message", function (e) {
      if (!e || !e.data || e.data.type !== "typwriter:back") return;
      var layout = null;
      try {
        layout = typeof ctx.get === "function" ? ctx.get("layout") : null;
      } catch (err) {
        layout = null;
      }
      if (!layout || typeof layout.selectPanel !== "function") {
        console.warn("[typwriter] layout service unavailable; cannot return to the conversation");
        return;
      }
      try {
        layout.selectPanel(null);
      } catch (err) {
        try {
          layout.selectPanel("conversation");
        } catch (err2) {
          console.warn("[typwriter] cannot switch back to the conversation", err, err2);
        }
      }
    });
  }
}

module.exports = { apply: apply, inject: inject };
return module.exports}})
