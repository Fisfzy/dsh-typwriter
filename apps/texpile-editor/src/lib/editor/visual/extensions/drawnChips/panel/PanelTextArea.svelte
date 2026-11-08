<script lang="ts">
	type Props = { value: string; label: string; oninput: (value: string) => void; mono?: boolean };

	const props: Props = $props();
</script>

<textarea
	class="border-surface-300-700 rounded-base focus:border-primary-500 field-sizing-content max-h-60 min-h-16 w-full resize-none border bg-transparent px-2 py-1 text-sm leading-normal outline-none {props.mono
		? 'font-mono'
		: ''}"
	aria-label={props.label}
	data-autofocus
	value={props.value}
	oninput={(e) => props.oninput(e.currentTarget.value)}></textarea>
