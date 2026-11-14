<script lang="ts">
	// 完全权限的确认条：沙箱全开意味着 AGENT 可执行任意命令，勾选确认后才落盘。
	// 状态在 permissionState.svelte（与 PromptBox 的权限下拉共享同一份）。
	import { permissionState, confirmDanger, cancelDanger } from '../../permissionState.svelte';
</script>

{#if permissionState.current.confirming}
	<div class="border-warning-300-700 bg-warning-tint rounded-base mt-1 border p-2 text-xs">
		<p class="mb-1 font-medium">启用完全权限？</p>
		<p class="text-muted mb-1.5">AGENT 将可以执行任意命令（跑脚本、写系统文件），不再受沙箱限制。仅建议在可信的本机环境使用。</p>
		<label class="mb-1.5 flex cursor-pointer items-center gap-1.5">
			<input type="checkbox" class="checkbox scale-75" bind:checked={permissionState.current.confirmChecked} />
			我了解此风险
		</label>
		<div class="flex gap-1">
			<button
				type="button"
				class="btn btn-xs preset-filled-primary-500"
				disabled={!permissionState.current.confirmChecked}
				onclick={confirmDanger}
			>
				启用完全权限
			</button>
			<button type="button" class="btn btn-xs preset-tonal" onclick={cancelDanger}>取消</button>
		</div>
	</div>
{/if}
