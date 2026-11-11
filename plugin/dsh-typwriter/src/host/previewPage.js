// Prepares tinymist's own preview page for display inside Typwriter（移植自 electron/src/typstPreviewPage.ts）.
//
// tinymist 把一个自包含的预览页（~1.6MB，renderer wasm 内联）编进了二进制，经 loopback 提供。
// 那个页面本身就是查看器：增量 SVG patch、ctrl+滚轮缩放、快捷键、点击跳转。我们不重写任何一部分，
// 取来加一点字符串替换后自己提供。
//
// 与 electron 版的两点差异：
//   1. 本插件只有一个 HTTP 服务器，注入页与 app 同源提供（/typwriter/preview-page）。
//      electron 用独立端口隔离来源，这里做不到——查看器 JS 是本地内置的可信代码，接受此取舍，
//      注释与计划文档里都有说明。
//   2. 桥脚本多了 `agent-click`：画布圈选把框的两个角点发进来，这里在查看器页面上派发合成点击，
//      让它自己的"点击→src-point→LSP 解析"链路原路给出源码位置（画布功能的根基）。
//
// 纯字符串工作，无依赖，便于直接单测。

/** 页面从自身 URL 推导 websocket 地址的表达式；我们同源提供，推导结果会指向 app 而不是数据面，必须钉死 */
const DERIVED_WS = 'new URL("/", window.location.href)';
/** tinymist 二进制内嵌页里的占位地址（静态服务器出的页面带的是这个） */
const PLACEHOLDER_WS = 'ws://127.0.0.1:23625';

function pageShadow(dark) {
	return dark
		? 'drop-shadow(0 2px 8px rgb(0 0 0 / 0.55)) drop-shadow(0 1px 3px rgb(0 0 0 / 0.4))'
		: 'drop-shadow(0 2px 8px rgb(0 0 0 / 0.12)) drop-shadow(0 1px 3px rgb(0 0 0 / 0.08))';
}

// PDF 布局的留白微调（与 electron 版同一组锚点，缺一不可时才整组应用）
const PDF_SPACING = [
	[
		'const computedScale = container.width ? container.width / maxWidth : 1;',
		'const computedScale = container.width ? (container.width - 40) / maxWidth : 1;'
	],
	[
		'const heightMargin = this.isContentPreview ? 6 * scale : 5 * scale;',
		'const heightMargin = this.isContentPreview ? 6 * scale : 8 * scale;'
	],
	['const widthMargin = 0;', 'const widthMargin = 20 * scale;'],
	[
		'const calculatedPaddedY = accumulatedHeight + (i == 0 ? 0 : heightMargin);',
		'const calculatedPaddedY = accumulatedHeight + (i == 0 ? 20 * scale : heightMargin);'
	],
	['const newHeight = accumulatedHeight;', 'const newHeight = accumulatedHeight + 20 * scale;']
];

function withPdfSpacing(html) {
	if (!PDF_SPACING.every(([from]) => html.includes(from))) return html;
	let out = html;
	for (const [from, to] of PDF_SPACING) out = out.replace(from, to);
	return out;
}

// CSS 值消毒：只放行颜色语法里会出现的字符（hex / rgb() / hsl() / 颜色词），
// 引号、分号、尖括号、花括号一律不过——注入页是 HTML 模板，别留注入口子
function cssColour(v) {
	const s = String(v ?? '').trim();
	if (s.length > 64) return '#ffffff';
	return /^[#%(),.\w\s-]+$/.test(s) ? s : '#ffffff';
}
function cssLength(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.max(0, Math.min(24, Math.round(n))) : 6;
}

function injection(opts) {
	return `
<style id="texpile-theme">
	/* !important 是必需的：页面自己的脚本会把颜色写成 <html> 的内联样式，普通规则赢不了它 */
	:root {
		--typst-preview-background-color: ${opts.background} !important;
		--typst-preview-foreground-color: ${opts.foreground} !important;
	}
	#typst-container svg:not(svg *) {
		filter: ${pageShadow(opts.dark)};
	}
	#typst-container, #typst-container * {
		cursor: default !important;
	}
	::-webkit-scrollbar {
		width: 10px;
		height: 10px;
	}
	::-webkit-scrollbar-track,
	::-webkit-scrollbar-corner {
		background: transparent;
	}
	::-webkit-scrollbar-thumb {
		background-color: color-mix(in oklab, ${opts.scrollbarThumb} 30%, transparent);
		border-radius: ${opts.scrollbarRadius}px;
		border: 2px solid transparent;
		background-clip: padding-box;
	}
	::-webkit-scrollbar-thumb:hover {
		background-color: color-mix(in oklab, ${opts.scrollbarThumb} 45%, transparent);
	}
	html.texpile-inverted #typst-container svg:not(svg *) {
		filter: invert(94%) hue-rotate(180deg) ${pageShadow(opts.dark)};
	}
</style>
<script id="texpile-bridge">
(function () {
	var CHANNEL = 'texpile-preview';
	// 包一层 WebSocket：记录连接状态给 status 用；follow 的客座跳转冻结靠它吞帧（同 electron 版）
	var sock = { url: null, state: -1, threw: null, closeCode: null, closeReason: null };
	var jumpFreezeUntil = 0;
	var Native = window.WebSocket;
	function WrappedWebSocket(url, protocols) {
		sock.url = String(url);
		sock.state = 0;
		var s;
		try {
			s = protocols === undefined ? new Native(url) : new Native(url, protocols);
		} catch (err) {
			sock.threw = String((err && err.name) || '') + ': ' + String((err && err.message) || err);
			throw err;
		}
		s.addEventListener('open', function () { sock.state = 1; });
		s.addEventListener('close', function (e) { sock.state = 3; sock.closeCode = e.code; sock.closeReason = e.reason; });
		s.addEventListener('message', function (e) {
			if (Date.now() >= jumpFreezeUntil) return;
			var head = '';
			if (typeof e.data === 'string') head = e.data.slice(0, 8);
			else if (e.data instanceof ArrayBuffer && e.data.byteLength <= 512) {
				try { head = new TextDecoder().decode(new Uint8Array(e.data, 0, Math.min(8, e.data.byteLength))); } catch (err) {}
			}
			if (/^(jump|cursor)([\\s,]|$)/.test(head)) e.stopImmediatePropagation();
		});
		return s;
	}
	WrappedWebSocket.prototype = Native.prototype;
	WrappedWebSocket.CONNECTING = 0; WrappedWebSocket.OPEN = 1; WrappedWebSocket.CLOSING = 2; WrappedWebSocket.CLOSED = 3;
	window.WebSocket = WrappedWebSocket;
	// 当前查看器实例：tinymist 把它推到容器元素上，重连是追加不是替换，取最后一个
	function view() {
		var c = document.getElementById('typst-container');
		var list = c && c.documents;
		if (!list || !list.length) return null;
		for (var i = list.length - 1; i >= 0; i--) if (list[i] && list[i].impl) return list[i];
		return null;
	}
	function zoomPercent() {
		var v = view();
		return v ? Math.round(v.impl.currentScaleRatio * 100) : null;
	}
	function step(dir) {
		var mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
		var ev = new KeyboardEvent('keydown', {
			key: dir > 0 ? '=' : '-',
			ctrlKey: !mac,
			metaKey: mac,
			bubbles: true,
			cancelable: true
		});
		document.body.dispatchEvent(ev);
	}
	function reply(type, value) {
		try { parent.postMessage({ channel: CHANNEL, type: type, value: value }, '*'); } catch (e) {}
	}
	// 诊断上报：预览页由插件自己的 loopback 服务提供，/diag 直接落到宿主日志。
	// 桌面端没有 DevTools 可用，这条通道让"框选不生效"能直接定位到阶段。
	function diag(obj) {
		try {
			obj.t = Date.now();
			fetch('/diag', { method: 'POST', body: JSON.stringify(obj), keepalive: true }).catch(function () {});
		} catch (e) {}
	}
	// 跳转涟漪：follow 期间是噪音，静默窗内的涟漪直接摘掉（滚动本身不动）
	var quietUntil = 0;
	var rippleHost = document.getElementById('typst-container-main');
	if (rippleHost) {
		new MutationObserver(function (muts) {
			for (var a = 0; a < muts.length; a++) {
				var nodes = muts[a].addedNodes;
				for (var b = 0; b < nodes.length; b++) {
					var n = nodes[b];
					if (n.nodeType === 1 && n.classList.contains('typst-jump-ripple') && Date.now() < quietUntil && n.parentNode) {
						n.parentNode.removeChild(n);
					}
				}
			}
		}).observe(rippleHost, { childList: true });
	}
	window.addEventListener('error', function (e) {
		reply('error', String((e && e.message) || 'script error') + (e && e.filename ? ' @ ' + e.filename : ''));
	});
	window.addEventListener('unhandledrejection', function (e) {
		reply('error', 'unhandled rejection: ' + String((e && e.reason && e.reason.message) || (e && e.reason) || '?'));
	});
	document.addEventListener('securitypolicyviolation', function (e) {
		reply('error', 'blocked by ' + e.violatedDirective + ': ' + (e.blockedURI || '?'));
	});
	function status() {
		var v = view();
		return {
			pages: document.querySelectorAll('.typst-page').length,
			socket: sock.state,
			socketUrl: sock.url,
			socketThrew: sock.threw,
			closeCode: sock.closeCode,
			closeReason: sock.closeReason,
			origin: String(location.origin),
			secureContext: !!window.isSecureContext,
			viewer: !!v,
			initialized: v ? !!v.impl.moduleInitialized : false,
			zoom: zoomPercent()
		};
	}
	var passingPinch = false;
	window.addEventListener('wheel', function (e) {
		if (passingPinch || !e.ctrlKey || e.deltaMode !== 0 || Math.abs(e.deltaY) >= 20) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		passingPinch = true;
		try {
			e.target.dispatchEvent(new WheelEvent('wheel', {
				deltaY: e.deltaY * 1.5, deltaMode: 0, ctrlKey: true,
				clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
				bubbles: true, cancelable: true
			}));
		} finally {
			passingPinch = false;
		}
	}, { capture: true, passive: false });
	var wheelZoomReport = 0;
	window.addEventListener('wheel', function (e) {
		if (!e.ctrlKey && !e.metaKey) return;
		clearTimeout(wheelZoomReport);
		wheelZoomReport = setTimeout(function () { reply('zoom', zoomPercent()); }, 50);
	}, { capture: true, passive: true });
	window.addEventListener('message', function (e) {
		var m = e.data;
		if (!m || typeof m !== 'object' || m.channel !== CHANNEL) return;
		if (m.type === 'zoom') { step(m.value); setTimeout(function () { reply('zoom', zoomPercent()); }, 0); }
		else if (m.type === 'quiet') quietUntil = Date.now() + (typeof m.value === 'number' ? m.value : 500);
		else if (m.type === 'freeze') jumpFreezeUntil = Date.now() + (typeof m.value === 'number' ? m.value : 1500);
		else if (m.type === 'query') reply('status', status());
		else if (m.type === 'invert') document.documentElement.classList.toggle('texpile-inverted', !!m.value);
		else if (m.type === 'agent-click') {
			// 画布圈选的角点：直接按查看器自己的映射算出**页内坐标**，走数据面发 src-point，
			// 由 tinymist 解析后经 LSP 回跳（画布角点就是这么来的）。
			//
			// 为什么不再只靠合成点击：合成事件在**跨源**预览页（桌面端 loopback 页）里不会
			// 触发查看器的点击处理（实测：同源页成功、跨源页 10s 超时）。而这段桥脚本本身
			// 就跑在预览页里，直接发数据面消息与页面来源无关——桌面端和 web 端同一套逻辑。
			//
			// 映射复刻查看器 installEditorJumpToHandler 的 resolveFrameLoc：
			// elementFromPoint → 最近的 .typst-page → 往前找同页号的 .typst-page-inner 矩形
			// → 归一化到 data-page-width/height；page_no 从 1 开始。
			// 页面几何：每个 .typst-page（g）都有一个兄弟背景矩形 .typst-page-inner，
			// 查看器的映射用背景矩形做归一化；这里抽出来供"页内命中"和"几何兜底"共用。
			function pageBg(pageEl) {
				var pageNumber = pageEl.getAttribute('data-page-number');
				if (pageNumber === null) return null;
				var bg = pageEl;
				for (var sib = pageEl; sib; sib = sib.previousElementSibling) {
					if (sib.classList && sib.classList.contains('typst-page-inner') && sib.getAttribute('data-page-number') === pageNumber) {
						bg = sib;
						break;
					}
				}
				var r = bg.getBoundingClientRect();
				if (!r.width || !r.height) return null;
				var pw = parseFloat(pageEl.getAttribute('data-page-width'));
				var ph = parseFloat(pageEl.getAttribute('data-page-height'));
				if (!isFinite(pw) || !isFinite(ph)) return null;
				var n = parseInt(pageNumber, 10);
				if (!isFinite(n)) return null;
				return { page: pageEl, n: n, w: pw, h: ph, r: r };
			}
			function locIn(geo, px, py) {
				// 夹取到页面矩形内：页边/页间空白处的角点也能落到最近的页面坐标
				var cx = Math.min(Math.max(px, geo.r.left), geo.r.right);
				var cy = Math.min(Math.max(py, geo.r.top), geo.r.bottom);
				return {
					page_no: geo.n + 1,
					x: ((cx - geo.r.left) / geo.r.width) * geo.w,
					y: ((cy - geo.r.top) / geo.r.height) * geo.h
				};
			}
			function rectDistance(r, px, py) {
				var dx = px < r.left ? r.left - px : px > r.right ? px - r.right : 0;
				var dy = py < r.top ? r.top - py : py > r.bottom ? py - r.bottom : 0;
				return Math.sqrt(dx * dx + dy * dy);
			}
			function resolveFrameLoc(px, py) {
				// 1) 命中元素在某一页的子树里（文字/图形）：用那一页
				var el = document.elementFromPoint(px, py);
				for (var cur = el; cur; cur = cur.parentElement) {
					if (cur.classList && cur.classList.contains('typst-page')) {
						var geo = pageBg(cur);
						if (geo) return locIn(geo, px, py);
						break;
					}
				}
				// 2) 命中页背景 rect / 页间空白：按几何找包含该点（或最近）的页面
				var best = null;
				var bestD = Infinity;
				var pages = document.querySelectorAll('.typst-page');
				for (var i = 0; i < pages.length; i++) {
					var g = pageBg(pages[i]);
					if (!g) continue;
					var d = rectDistance(g.r, px, py);
					if (d === 0) { best = g; bestD = 0; break; }
					if (d < bestD) { bestD = d; best = g; }
				}
				if (!best) return null;
				return locIn(best, px, py);
			}
			function sendSrcPoint(fl) {
				var cont = document.getElementById('typst-container');
				var ws = cont && cont.typstWebsocket;
				if (!ws || ws.readyState !== 1) return false;
				try {
					ws.send('src-point ' + JSON.stringify(fl));
					return true;
				} catch (e) {
					return false;
				}
			}
			var cx = Number(m.x), cy = Number(m.y);
			if (!isFinite(cx) || !isFinite(cy)) return;
			var hit = document.elementFromPoint(cx, cy);
			diag({ stage: 'recv', x: cx, y: cy, el: hit ? hit.tagName : null, cls: hit ? String(hit.className && hit.className.baseVal || hit.className || '').slice(0, 60) : null });
			var loc = resolveFrameLoc(cx, cy);
			var contEl = document.getElementById('typst-container');
			var sockEl = contEl && contEl.typstWebsocket;
			diag({ stage: 'map', loc: loc, ws: sockEl ? sockEl.readyState : null, pages: document.querySelectorAll('.typst-page').length });
			if (loc && sendSrcPoint(loc)) {
				diag({ stage: 'sent', loc: loc });
				return;
			}
			// 兜底：合成点击（同源页可用；跨源页多半不生效，但保持旧行为不更糟）
			diag({ stage: 'fallback', loc: loc, ws: sockEl ? sockEl.readyState : null });
			var el = document.elementFromPoint(cx, cy);
			if (!el) { reply('error', 'agent-click: no element at ' + cx + ',' + cy); return; }
			var base = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, pointerId: 7, isPrimary: true, pointerType: 'mouse' };
			try {
				el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ buttons: 1 }, base)));
				el.dispatchEvent(new MouseEvent('mousedown', Object.assign({ buttons: 1 }, base)));
				el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ buttons: 0 }, base)));
				el.dispatchEvent(new MouseEvent('mouseup', Object.assign({ buttons: 0 }, base)));
				el.dispatchEvent(new MouseEvent('click', Object.assign({ buttons: 0 }, base)));
			} catch (err) {
				reply('error', 'agent-click dispatch failed: ' + String((err && err.message) || err));
			}
		}
	});
	var tries = 0;
	function report() {
		var s = status();
		reply('status', s);
		if (s.pages > 0) return;
		tries++;
		setTimeout(report, tries > 150 ? 1000 : 200);
	}
	report();
})();
</script>
`;
}

/**
 * 改写页面让它能在我们的框架里跑。
 *
 * websocket 地址钉不上去就直接抛错：宁可启动时清晰失败，也不要一块永远空白的预览。
 */
export function preparePreviewPage(html, opts) {
	if (!/^[\w.-]+:\d+$/.test(opts.dataPlaneHost)) {
		throw new Error(`refusing a malformed data plane host: ${opts.dataPlaneHost}`);
	}
	let out = html;
	if (out.includes(DERIVED_WS)) {
		out = out.replace(DERIVED_WS, `new URL(${JSON.stringify(`http://${opts.dataPlaneHost}/`)})`);
	} else if (out.includes(PLACEHOLDER_WS)) {
		out = out.split(PLACEHOLDER_WS).join(`ws://${opts.dataPlaneHost}`);
	} else {
		throw new Error('tinymist preview page has neither the derived nor the placeholder websocket address');
	}
	out = withPdfSpacing(out);
	const inject = injection(opts);
	const close = out.lastIndexOf('</body>');
	return close >= 0 ? out.slice(0, close) + inject + out.slice(close) : out + inject;
}

// 同一 host+主题只准备一次；页面内容随 tinymist 二进制走，进程内缓存即可
const cache = new Map();

/**
 * 取 tinymist 页面并注入，返回可直接发给浏览器的 HTML。所有失败都以 Error 抛出，由路由层转成响应。
 */
export async function preparedPreviewHtml({ host, background, foreground, scrollbarThumb, scrollbarRadius, dark }) {
	if (!/^127\.0\.0\.1:\d+$/.test(String(host ?? ''))) {
		throw new Error('refusing a non-loopback preview host');
	}
	const opts = {
		dataPlaneHost: host,
		background: cssColour(background),
		foreground: cssColour(foreground),
		scrollbarThumb: cssColour(scrollbarThumb),
		scrollbarRadius: cssLength(scrollbarRadius),
		dark: dark === true || dark === '1' || dark === 'true'
	};
	const key = JSON.stringify([opts.dataPlaneHost, opts.background, opts.foreground, opts.scrollbarThumb, opts.scrollbarRadius, opts.dark]);
	const hit = cache.get(key);
	if (hit) return hit;
	const res = await fetch(`http://${opts.dataPlaneHost}/`, { signal: AbortSignal.timeout(15000) });
	if (!res.ok) throw new Error(`preview server answered ${res.status}`);
	const page = preparePreviewPage(await res.text(), opts);
	cache.set(key, page);
	return page;
}
