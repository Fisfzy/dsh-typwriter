-- Writes every SHIPPED PAGE's walker records + the pages.json manifest -- nothing else.
-- (Each page box is the engine's final exact layout: columns, floats, page breaks.)
-- Records go to <outdir>/page-NNN.jsonl. Registered from the .tex via the LaTeX kernel
-- shipout hook: \AddToHook{shipout/before}{\directlua{page_extract(\the\ShipoutBox)}}
--
-- Product config (set as Lua globals in the injecting job string before dofile):
--   TEXPILE_ENGINE_DIR -- absolute dir holding walker.lua (read-only; reads aren't
--                         sandboxed, so an absolute app-resources path is fine)
--   TEXPILE_DRAFT_OUT  -- relative subdir for the jsonl/manifest (writes ARE sandboxed;
--                         must be a relative path under cwd, e.g. "_draft")
-- ENGINE_DIR must be provided by the injecting job string; "." is only a last resort.
local ENGINE_DIR = TEXPILE_ENGINE_DIR or "."
local OUT = TEXPILE_DRAFT_OUT and (TEXPILE_DRAFT_OUT .. "/") or ""
local walker = dofile(ENGINE_DIR .. "/walker.lua")
local pageno = 0
local pages = {}

-- Seam capture: the vertical material TeX prunes at every column/page break (the glue
-- run that would sit at the junction if the break moved) plus the break's \outputpenalty.
-- \savingvdiscards makes the engine SAVE each break's pruned run (eTeX \pagediscards);
-- the run for the break that filled box255 is only complete at the NEXT output firing,
-- so each pre_output_filter snapshot belongs to the PREVIOUS firing's break. Real breaks
-- have \outputpenalty >= -10000; LaTeX's float/clearpage cycles run below that and get
-- no seam entry (their box255 is recycled, not a column).
local seam_pending, seam_done, seam_cols = nil, {}, 0
-- \AtEndDocument has run: from here every shipout rewrites the manifest (see page_extract)
local doc_ended = false
local GLUE_ID, KERN_ID, PEN_ID = node.id("glue"), node.id("kern"), node.id("penalty")

local function seam_run_json()
	local out, n, cnt = {}, tex.lists.page_discards_head, 0
	while n and cnt < 40 do
		if n.id == GLUE_ID then
			out[#out + 1] = string.format('{"w":%.4f,"st":%.4f,"sto":%d,"sh":%.4f,"sho":%d}',
				(n.width or 0) / 65536.0, (n.stretch or 0) / 65536.0, n.stretch_order or 0,
				(n.shrink or 0) / 65536.0, n.shrink_order or 0)
		elseif n.id == KERN_ID then
			out[#out + 1] = string.format('{"k":%.4f}', (n.kern or 0) / 65536.0)
		elseif n.id == PEN_ID then
			out[#out + 1] = string.format('{"p":%d}', n.penalty or 0)
		else
			-- the engine only saves glue/kern/penalty; anything else marks the run unusable
			out[#out + 1] = '{"x":true}'
		end
		n = n.next
		cnt = cnt + 1
	end
	-- a run longer than the cap is TRUNCATED, and a short seam is worse than no seam:
	-- poison it the same way an unrepresentable node does
	if n then out[#out + 1] = '{"x":true}' end
	return "[" .. table.concat(out, ",") .. "]"
end

-- Column identity: stamp every top-level node of the list becoming \box255 with the ordinal
-- of the firing that built it. At shipout the box still holding them IS a column, which is
-- how the walker names column origins from the engine instead of clustering glyph lefts.
-- Counted separately from seam_cols: that one skips float/clearpage cycles and resets per
-- page, while the stamp only has to be unique across the run.
local col_attr, col_firing = nil, 0

-- declared here, above the registration below, so the assignment there binds THESE locals:
-- declaring them after it would leave the registration writing globals while every reader
-- closes over locals that stay nil
local src_line_attr, src_file_attr
local src_files, src_filen = {}, 0

-- each firing's page goal and \maxdepth: the size box255 is packed to (\vsize less the room
-- inserts took), which is the page builder's own capacity for that galley
local goals = {}
walker.goals = goals

-- a float or \marginpar first fires the output at -10004 with the page so far (LaTeX holds it,
-- then places the float by that height). The last box of it takes the anchor mark
local anchor_attr
local HLIST_ID, VLIST_ID, RULE_ID = node.id("hlist"), node.id("vlist"), node.id("rule")
local function mark_anchor(head)
	local last
	for n in node.traverse(head) do
		if (n.id == HLIST_ID or n.id == VLIST_ID or n.id == RULE_ID) and (n.height + n.depth > 0 or n.id == RULE_ID) then last = n end
	end
	if last then node.set_attribute(last, anchor_attr, 1) end
end

local function seam_mark(head, _, size, _, maxdepth)
	if col_attr then
		col_firing = col_firing + 1
		local n = head
		while n do
			node.set_attribute(n, col_attr, col_firing)
			n = n.next
		end
		if size then goals[col_firing] = { size, maxdepth or 0 } end
	end
	local pen = tex.outputpenalty or 0
	if anchor_attr and pen == -10004 then mark_anchor(head) end
	if seam_pending then
		seam_pending.run = seam_run_json()
		seam_done[#seam_done + 1] = seam_pending
		seam_pending = nil
	end
	if pen >= -10000 then
		seam_cols = seam_cols + 1
		-- `fire` is THIS firing's ordinal, the same number stamped on the column it just
		-- built. It ties a seam to its column directly, where matching by counted position
		-- only works when every column of the page fired on its own.
		seam_pending = { pen = pen, col = seam_cols, fire = col_firing }
	end
	return true
end

-- registration is best-effort: a build without luatexbase just compiles seamless.
-- The attribute gets its own pcall so that losing it cannot also cost us the seams.
pcall(function()
	col_attr = luatexbase.new_attribute("texpilecolumn")
	walker.colattr = col_attr
end)
pcall(function()
	src_line_attr = luatexbase.new_attribute("texpilesrcline")
	src_file_attr = luatexbase.new_attribute("texpilesrcfile")
	walker.srcline, walker.srcfile = src_line_attr, src_file_attr
end)
pcall(function()
	anchor_attr = luatexbase.new_attribute("texpileanchor")
	walker.anchorattr = anchor_attr
end)
pcall(function()
	tex.set("global", "savingvdiscards", 1)
	luatexbase.add_to_callback("pre_output_filter", seam_mark, "texpile.seam")
end)

-- The interline glue TeX just put between a paragraph's lines, stamped with the parameters it
-- was computed from: \baselineskip, \lineskip, \lineskiplimit as they stood at this line
-- break. A certificate recomputing that glue beside an edited line needs the paragraph's own
-- values, which a local \small or \linespread makes different from the document's.
local IL_GLUE = node.id("glue")
local il_attrs

-- Paragraph truth: every parameter TeX broke a paragraph and stacked its lines with, as it stood at the
-- break, plus its font when it started and the indent box it opened with. The instant path typesets an
-- edited paragraph with these rather than the document's defaults: a paragraph under a heading carries
-- \clubpenalty 10000, an abstract its own font and leading, and a default in their place is a different
-- paragraph the page builder would break differently. Keyed by a serial the paragraph's glyphs carry.
local para_attr
local para_n = 0
local para_font, para_params = {}, {}
local GLYPH_ID, LOCALPAR_ID, DIR_ID = node.id("glyph"), node.id("local_par"), node.id("dir")
local INDENT_SUB = 3
pcall(function()
	for k, v in pairs(node.subtypes("hlist")) do if v == "indent" then INDENT_SUB = k end end
end)

local function glue_json(name)
	local w, st, sh, sto, sho = tex.getglue(name)
	return string.format("[%.4f,%.4f,%d,%.4f,%d]", (w or 0) / 65536, (st or 0) / 65536, sto or 0, (sh or 0) / 65536, sho or 0)
end

-- which paragraph is being broken: the one para/end just closed, or, when a display cut the paragraph
-- before its end, the one still open. Paragraphs nest (a cell, a footnote, a minipage), hence the stack
local para_open, para_closed = {}, nil

local function breaking_serial()
	local s = para_closed or para_open[#para_open]
	para_closed = nil
	return s
end

-- the indent box TeX opened the paragraph with, as the first line's first node after its par node
local function indent_of(head)
	for n in node.traverse(head) do
		if n.id == HLIST_ID and n.subtype == 1 then
			-- before the first glyph or box: a CJK engine puts its own nodes ahead of the indent box
			for m in node.traverse(n.head) do
				if m.id == HLIST_ID and m.subtype == INDENT_SUB then return m.width / 65536 end
				if m.id == GLYPH_ID or m.id == HLIST_ID or m.id == VLIST_ID or m.id == RULE_ID then return 0 end
			end
			return 0
		end
	end
	return 0
end

local function record_paragraph(head)
	local serial = breaking_serial()
	if not serial then return end
	-- the lines carry it themselves: a line's first glyph can belong to a paragraph inside it (a cell)
	for n in node.traverse_id(HLIST_ID, head) do
		if n.subtype == 1 then node.set_attribute(n, para_attr, serial) end
	end
	if para_params[serial] then return end
	local function c(name) return tex.get(name) or 0 end
	para_params[serial] = string.format(
		'"ind":%.4f,"pen":[%d,%d,%d,%d,%d],"lb":[%d,%d,%.4f,%d,%d,%d,%d,%d,%d,%d,%d,%d],"ls":%s,"rs":%s,"pf":%s,"bs":%s,"lk":%s,"ll":%.4f,"hang":[%.4f,%d]',
		indent_of(head),
		c("clubpenalty"), c("widowpenalty"), c("interlinepenalty"), c("brokenpenalty"), c("displaywidowpenalty"),
		c("pretolerance"), c("tolerance"), c("emergencystretch") / 65536, c("looseness"), c("linepenalty"), c("hyphenpenalty"),
		c("exhyphenpenalty"), c("adjdemerits"), c("doublehyphendemerits"), c("finalhyphendemerits"), c("lefthyphenmin"), c("righthyphenmin"),
		glue_json("leftskip"), glue_json("rightskip"), glue_json("parfillskip"), glue_json("baselineskip"), glue_json("lineskip"),
		c("lineskiplimit") / 65536, c("hangindent") / 65536, c("hangafter"))
end

local function stamp_interline(head)
	if para_attr then record_paragraph(head) end
	local bs, lk, ll = tex.getglue("baselineskip"), tex.getglue("lineskip"), tex.get("lineskiplimit")
	local _, bst, bsh, bsto, bsho = tex.getglue("baselineskip")
	local _, lst, lsh, lsto, lsho = tex.getglue("lineskip")
	-- infinite stretch in either would make the switch between them more than a width
	if (bsto or 0) ~= 0 or (bsho or 0) ~= 0 or (lsto or 0) ~= 0 or (lsho or 0) ~= 0 then return true end
	local vals = { bs, bst or 0, bsh or 0, lk, lst or 0, lsh or 0, ll }
	for n in node.traverse_id(IL_GLUE, head) do
		if n.subtype == 1 or n.subtype == 2 then
			for k = 1, 7 do node.set_attribute(n, il_attrs[k], vals[k]) end
		end
	end
	return true
end
pcall(function()
	il_attrs = {}
	for k, nm in ipairs({ "bs", "bsst", "bssh", "lk", "lkst", "lksh", "ll" }) do il_attrs[k] = luatexbase.new_attribute("texpileil" .. nm) end
	walker.ilattrs = il_attrs
	para_attr = luatexbase.new_attribute("texpilepara")
	walker.paraattr = para_attr
	luatexbase.add_to_callback("post_linebreak_filter", stamp_interline, "texpile.interline")
end)

-- Source-line truth for the instant path: each paragraph stamps its own first source line
-- and file onto the nodes it produces, so the walker can say which line of the document a
-- line of the page came from. That is the question the locate tier answers today by
-- searching -- snapping synctex boxes to a baseline grid, fingerprinting glyph rows,
-- typesetting calibration variants against every column of every page.
--
-- The stamp is driven from Lua rather than TeX so the file table is built as a side effect
-- of stamping instead of needing a second channel. Line numbers are FILE-LOCAL (a paragraph
-- in an \input'ed fragment reports its line within that fragment), hence the file id.
--
-- Deliberately NOT covered: \item. Its paragraph starts late enough that \inputlineno has
-- moved on, so the second item of a list reports the first item's line, and nesting drifts
-- further (measured: up to 4 lines, with two items claiming the same line). Consumers verify
-- content before trusting a claim, so a list item simply fails that check and falls back to
-- the search; it is never mislocated.
function texpile_para()
	if not src_line_attr then return end
	local f = ((status and status.filename or ""):gsub("\\", "/"):match("[^/]+$") or ""):lower()
	local id = src_files[f]
	if not id then
		src_filen = src_filen + 1
		src_files[f] = src_filen
		id = src_filen
	end
	tex.setattribute(src_line_attr, tex.inputlineno)
	tex.setattribute(src_file_attr, id)
	if para_attr then
		para_n = para_n + 1
		para_open[#para_open + 1] = para_n
		para_closed = nil
		tex.setattribute(para_attr, para_n)
		local function mac(nm) return ((token.get_macro(nm) or ""):gsub('[%c"\\]', "")) end
		para_font[para_n] = string.format('"font":{"e":"%s","f":"%s","s":"%s","h":"%s","z":"%s","b":"%s"}',
			mac("f@encoding"), mac("f@family"), mac("f@series"), mac("f@shape"), mac("f@size"), mac("f@baselineskip"))
	end
end

-- content outside any paragraph (a float caption, a running head) must read as UNKNOWN
-- rather than inherit the last paragraph's line and claim to be text it is not
function texpile_para_end()
	if not src_line_attr then return end
	tex.setattribute(src_line_attr, -2147483647)
	tex.setattribute(src_file_attr, -2147483647)
	if para_attr then
		tex.setattribute(para_attr, -2147483647)
		para_closed = table.remove(para_open)
	end
end

local function src_files_json()
	local inv = {}
	for f, i in pairs(src_files) do inv[i] = f end
	local t = {}
	for i = 1, src_filen do t[i] = '"' .. tostring(inv[i] or ""):gsub('[%c"\\]', "") .. '"' end
	return "[" .. table.concat(t, ",") .. "]"
end

-- Counter truth for the instant path: a snapshot of the standard counters at every
-- \stepcounter/\setcounter (the job string wraps them), keyed by source line + input
-- file. The daemon pins to these TRUE values, so a heading/footnote/item patch can
-- reproduce the page's own numbers and certify instead of rendering a pinned 0.
local COUNTER_NAMES = { "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph",
	"footnote", "enumi", "enumii", "enumiii", "enumiv", "figure", "table", "equation" }
local counter_have -- probed once: which of these this document defines
local counter_log = {}
local body_line

function texpile_begindoc(line)
	body_line = line
end

function texpile_counters(line)
	if not counter_have then
		counter_have = {}
		for _, nm in ipairs(COUNTER_NAMES) do
			if pcall(function() return tex.count["c@" .. nm] end) then counter_have[#counter_have + 1] = nm end
		end
	end
	local vals = {}
	for _, nm in ipairs(counter_have) do
		vals[#vals + 1] = string.format('"%s":%d', nm, tex.count["c@" .. nm])
	end
	local f = ((status and status.filename or ""):gsub("\\", "/"):match("[^/]+$") or ""):gsub('[%c"\\]', "")
	local entry = string.format('{"l":%d,"f":"%s","s":{%s}}', line, f:lower(), table.concat(vals, ","))
	-- \stepcounter chains snapshot identically; keep one
	if counter_log[#counter_log] ~= entry then counter_log[#counter_log + 1] = entry end
end

-- Rewrite the manifest after EVERY shipout: \AtEndDocument hooks run BEFORE the final
-- \clearpage ships the last page, so an end-of-run write would miss it (a one-page
-- document would report count 0). The manifest is tiny; per-page rewrite is free.
local function write_manifest()
	local f = io.open(OUT .. "pages.json", "w")
	if not f then return end
	-- paper dims in TeX pt (same unit as the walker's glyph coords, so the renderer needs
	-- no bp/pt conversion). LaTeX's \paperwidth/\paperheight are named dimens.
	local pw = (tex.dimen and tex.dimen["paperwidth"] or 0) / 65536.0
	local ph = (tex.dimen and tex.dimen["paperheight"] or 0) / 65536.0
	-- \columnwidth is the exact width TeX wrapped body text to (one column in twocolumn
	-- mode); the instant patch calibrates the warm daemon to this so it reproduces the
	-- page's line breaks. Falls back to \textwidth (single-column docs) then 0.
	local cw = (tex.dimen and (tex.dimen["columnwidth"] or tex.dimen["textwidth"]) or 0) / 65536.0
	-- \textwidth too: under twocolumn a starred float wraps at THIS width, not \columnwidth,
	-- and the instant path needs the engine's value to calibrate full-width bands
	local tw = (tex.dimen and tex.dimen["textwidth"] or 0) / 65536.0
	-- \footskip separates the body bottom from the footer baseline (= the shipout box
	-- baseline, ht): body bottom in record space is ht - footskip
	local fsk = (tex.dimen and tex.dimen["footskip"] or 0) / 65536.0
	-- more engine registers the instant path used to guess: \columnsep (column origin
	-- synthesis), \baselineskip and \parskip (line-gap fallbacks and flow-gap bounds)
	local csep = (tex.dimen and tex.dimen["columnsep"] or 0) / 65536.0
	-- \hoffset/\voffset displace the page's reference point away from TeX's 1in default.
	-- The renderer used to assume the default for every document, so a class or preamble
	-- that moves the origin painted every page displaced with nothing able to detect it.
	local hoff, voff = 0, 0
	pcall(function() hoff = tex.dimen["hoffset"] / 65536.0 end)
	pcall(function() voff = tex.dimen["voffset"] / 65536.0 end)
	local bls, pks, tsk = 0, 0, 0
	pcall(function() bls = tex.getglue("baselineskip") / 65536.0 end)
	pcall(function() pks = tex.getglue("parskip") / 65536.0 end)
	-- \topskip governs where a column's FIRST baseline lands: the chain planner needs it
	-- to place carried lines at a receiving column's top the way the page builder would
	pcall(function() tsk = tex.getglue("topskip") / 65536.0 end)
	-- \lineskiplimit decides whether TeX puts \baselineskip or \lineskip between two lines: a skeleton
	-- recomputing that glue beside an edited line has to know where the switch falls
	local lsl = 0
	pcall(function() lsl = tex.get("lineskiplimit") / 65536.0 end)
	local t = {}
	for i = 1, pageno do
		local p = pages[i]
		-- the walker's certification reasons for THIS page (nil when it is fully renderable).
		-- The instant path has always had this per block; without it on the page the renderer
		-- had no way to know a page's records were unsafe to paint (RTL, in practice).
		local unc = p.unc and string.format(',"unc":"%s"', p.unc) or ""
		local dev = p.dev and string.format(',"dev":%.4f', p.dev) or ""
		-- the shipped vpack's glue state: gsn 1 = the page was stretched to \textheight
		-- (flushbottom), so a patch must distribute its delta over the page's vg records
		-- the way a repack would, not shift rigidly
		t[i] = string.format('{"n":%d,"w":%.4f,"h":%.4f,"ht":%.4f,"gs":%.6f,"gsn":%d,"go":%d%s}',
			i, p.w, p.h, p.ht, p.gs or 0, p.gsn or 0, p.go or 0, unc .. dev)
	end
	f:write(string.format(
		'{"count":%d,"paperW":%.4f,"paperH":%.4f,"colW":%.4f,"textW":%.4f,"footSkip":%.4f,"colSep":%.4f,"blSkip":%.4f,"parSkip":%.4f,"topSkip":%.4f,"lsLimit":%.4f,"hOffset":%.4f,"vOffset":%.4f,"srcFiles":%s%s,"pages":[%s]}',
		pageno, pw, ph, cw, tw, fsk, csep, bls, pks, tsk, lsl, hoff, voff, src_files_json(),
		body_line and string.format(',"bodyLine":%d', body_line) or "", table.concat(t, ",")))
	f:close()
	-- counter snapshots ride a sidecar (they are per-line, not per-page)
	local cf = io.open(OUT .. "counters.jsonl", "w")
	if cf then
		cf:write(table.concat(counter_log, "\n"))
		cf:close()
	end
	-- each paragraph's parameters, by the serial its lines carry (pl.pi)
	local pf = io.open(OUT .. "paras.jsonl", "w")
	if pf then
		local lines = {}
		for i = 1, para_n do
			if para_params[i] then lines[#lines + 1] = string.format('{"i":%d,%s,%s}', i, para_font[i] or '"font":null', para_params[i]) end
		end
		pf:write(table.concat(lines, "\n"))
		pf:close()
	end
	-- completed seams ride a sidecar too: a page's LAST seam only finishes at the next
	-- page's first firing, after that page's jsonl is already written
	local sf = io.open(OUT .. "seams.jsonl", "w")
	if sf then
		local lines = {}
		for _, s in ipairs(seam_done) do
			if s.page and s.run then
				lines[#lines + 1] = string.format('{"page":%d,"col":%d,"fire":%d,"pen":%d,"run":%s}',
					s.page, s.col, s.fire or 0, s.pen, s.run)
			end
		end
		sf:write(table.concat(lines, "\n"))
		sf:close()
	end
end

function page_extract(boxnum)
	local b = tex.box[boxnum]
	if not b then return end
	pageno = pageno + 1
	-- attribute breaks to this page: the firing shipping it is its last real break, and
	-- every completed-but-unowned seam was an earlier column of it. Guarded nil-checks:
	-- a firing can ship several pages (trailing float pages) and must claim only once.
	if seam_pending and not seam_pending.page then seam_pending.page = pageno end
	for _, s in ipairs(seam_done) do
		if not s.page then s.page = pageno end
	end
	seam_cols = 0
	-- The page's DIMENSIONS come from the box and are known whether or not the walk succeeds,
	-- so record them unconditionally. Registering them only on success left a hole in `pages`
	-- at the failed index, and the next page's write_manifest then indexed that nil and threw
	-- out of the shipout hook -- one bad page destroyed the manifest for the whole document.
	local ok, records, stats = pcall(walker.lines, b.head)
	pages[pageno] = {
		w = (b.width or 0) / 65536,
		h = ((b.height or 0) + (b.depth or 0)) / 65536,
		ht = (b.height or 0) / 65536,
		gs = b.glue_set or 0,
		gsn = b.glue_sign or 0,
		go = b.glue_order or 0,
		unc = ok and stats and stats.uncertified or nil,
		-- the walker's OWN proof for this page: how far its pen finished from the engine's
		-- line width on the worst justified line. Computed since the beginning and never read.
		dev = ok and stats and stats.maxdev or nil
	}
	if ok then
		local f = io.open(string.format("%spage-%03d.jsonl", OUT, pageno), "w")
		if f then f:write(table.concat(records, "\n")); f:close() end
	end
	-- The manifest serializes EVERY page each time it is written, so writing it per shipout
	-- was O(n^2) -- measured 6.8s of a 907-page pass, with no reader before the process
	-- exits. It exists per-page only because \AtEndDocument fires BEFORE the final
	-- \clearpage ships the last page(s): so stay silent until finish has run, and let every
	-- post-finish shipout rewrite it -- the last one to fire leaves the complete file.
	if doc_ended then write_manifest() end
end

function page_extract_finish()
	doc_ended = true
	write_manifest()
end

-- Warm-compile handshake. The wrapper calls this right after the preamble: hooks are
-- registered, \begin{document} has run, fonts are loaded -- everything a pass pays for
-- before the first page. Hold here until the driver has written the BODY (padded so its
-- line numbers equal the main file's) and answers GO; anything else aborts the process,
-- which the driver treats as "compile cold".
function texpile_warm_wait()
	io.write("TEXPILE_WARM_READY\n")
	io.flush()
	local l = io.stdin:read("*l")
	if l then l = l:gsub("\r$", "") end
	if l ~= "GO" then os.exit(101) end
end
