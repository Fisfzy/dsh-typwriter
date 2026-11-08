// The collab reserialize path (VisualCollab.runRemotePatch) re-parses the serialized source and
// block-patches the live doc. Serialize->parse is lossy at a block's in-progress tail in every
// dialect - trailing whitespace is dropped, a whitespace-only paragraph disappears - so without
// protectCaretBlock the patch clobbers the block being typed in. These tests mirror the real
// flow: parse, type, serialize, re-parse, guard, patch.
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { parseTypstFile, serializeTypstFile } from '$lib/languages/typst/visual/roundtrip';
import { parseMarkdownFile, serializeMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';
import { parseLatexFile, serializeLatexFile } from '$lib/workspace/latexRoundtrip';
import { computeBlockPatch, protectCaretBlock } from '$lib/editor/visual/blockPatch';

interface Lane {
	name: string;
	parse: (s: string) => { doc: PMNode; preamble: string; postamble: string; hadDocumentEnv: boolean };
	serialize: (parsed: { preamble: string; postamble: string; hadDocumentEnv: boolean }, doc: PMNode) => string;
	src: string;
}

const lanes: Lane[] = [
	{ name: 'typ', parse: (s) => parseTypstFile(s), serialize: serializeTypstFile, src: 'Hello world.\n\nSecond para.\n' },
	{ name: 'md', parse: (s) => parseMarkdownFile(s), serialize: serializeMarkdownFile, src: 'Hello world.\n\nSecond para.\n' },
	{
		name: 'tex',
		parse: (s) => parseLatexFile(s),
		serialize: serializeLatexFile,
		src: '\\documentclass{article}\n\\begin{document}\nHello world.\n\nSecond para.\n\\end{document}\n'
	}
];

function blockTexts(doc: PMNode): string[] {
	const out: string[] = [];
	for (let i = 0; i < doc.childCount; i++) out.push(doc.child(i).textContent);
	return out;
}

/** the guarded patch applied; asserts the live blocks all survive (an extra trailing empty
 *  paragraph stays tolerated - empty paragraphs serialize to nothing, so either side of the
 *  patch may legitimately hold one more than the other). */
function assertNothingLost(live: PMNode, head: number, parsed: { doc: PMNode }, label: string) {
	const guarded = protectCaretBlock(live, parsed.doc, head);
	const patch = computeBlockPatch(live, guarded);
	let result = live;
	if (patch) {
		let s = EditorState.create({ schema: live.type.schema, doc: live });
		s = s.apply(s.tr.replaceWith(patch.from, patch.to, patch.nodes));
		result = s.doc;
	}
	const got = blockTexts(result);
	const want = blockTexts(live);
	const ok = JSON.stringify(got) === JSON.stringify(want) || JSON.stringify(got) === JSON.stringify([...want, '']);
	if (!ok) expect.fail(`${label}: live ${JSON.stringify(want)} became ${JSON.stringify(got)}`);
}

const probes = ['#', '#t', '# ', ' ', 'x '];

for (const lane of lanes) {
	describe(`protectCaretBlock: ${lane.name}`, () => {
		for (const probe of probes) {
			it(`typing ${JSON.stringify(probe)} at the end of a paragraph survives the re-parse`, () => {
				const parsed = lane.parse(lane.src);
				const live0 = parsed.doc;
				let s = EditorState.create({ schema: live0.type.schema, doc: live0 });
				const head = 1 + live0.child(0).content.size;
				s = s.apply(s.tr.insertText(probe, head));
				const live = s.doc;
				const out = lane.serialize(parsed, live);
				assertNothingLost(live, head + probe.length, lane.parse(out), `${lane.name} para-end ${JSON.stringify(probe)}`);
			});

			it(`typing ${JSON.stringify(probe)} in a just-opened paragraph at doc end survives the re-parse`, () => {
				const parsed = lane.parse(lane.src);
				const live0 = parsed.doc;
				let s = EditorState.create({ schema: live0.type.schema, doc: live0 });
				// Enter at the end of the document opens a fresh paragraph; type into it
				const at = live0.content.size;
				s = s.apply(s.tr.insert(at, live0.type.schema.nodes.paragraph.create()));
				s = s.apply(s.tr.insertText(probe, at + 1));
				const live = s.doc;
				const out = lane.serialize(parsed, live);
				assertNothingLost(live, at + 1 + probe.length, lane.parse(out), `${lane.name} new-para ${JSON.stringify(probe)}`);
			});
		}

		it('a just-opened empty paragraph mid-doc survives the re-parse', () => {
			const parsed = lane.parse(lane.src);
			const live0 = parsed.doc;
			let s = EditorState.create({ schema: live0.type.schema, doc: live0 });
			const para = live0.type.schema.nodes.paragraph.create();
			const at = live0.child(0).nodeSize; // between the first and second block
			s = s.apply(s.tr.insert(at, para));
			const live = s.doc;
			const out = lane.serialize(parsed, live);
			assertNothingLost(live, at + 1, lane.parse(out), `${lane.name} empty-para`);
		});

		it('a genuine remote edit in the caret block still applies', () => {
			const parsed = lane.parse(lane.src);
			const live = parsed.doc;
			// remote rewrote the first paragraph; caret sits inside it
			const remote = lane.parse(lane.src.replace('Hello world.', 'Hello REMOTE world.'));
			const guarded = protectCaretBlock(live, remote.doc, 3);
			const patch = computeBlockPatch(live, guarded);
			expect(patch).not.toBeNull();
			expect(patch!.nodes.some((n) => n.textContent.includes('REMOTE'))).toBe(true);
		});
	});
}
