// AGENT 面板的权限预设状态：读/写 DSH profile patch 的 defaultPreset（与 DSH 设置界面
// 同一落点），新对话继承。完全权限（danger-full-access）的确认交互也在这里管理——
// AgentPromptBox 只渲染状态。
import { box } from '$lib/runes/box.svelte';

const PERM_LABELS: Record<string, string> = {
	'read-only': '仅可查看',
	'workspace-write': '工作区内修改',
	'danger-full-access': '完全权限'
};

export const permissionState = box({
	preset: 'workspace-write',
	loaded: false,
	/** 完全权限的确认框：选了 danger 后置真，确认/取消各走各的 */
	confirming: false,
	confirmChecked: false,
	pending: null as string | null
});

export function permLabel(preset: string): string {
	return PERM_LABELS[preset] ?? preset;
}

export function permissionOptions(): { value: string; label: string; checked: boolean }[] {
	return Object.entries(PERM_LABELS).map(([value, label]) => ({ value, label, checked: value === permissionState.current.preset }));
}

export function loadPermission(): void {
	void (window as unknown as { texpileAgent?: { permissionGet?: () => Promise<{ preset?: string }> } }).texpileAgent
		?.permissionGet?.()
		.then((r) => {
			if (r?.preset) permissionState.current.preset = r.preset;
			permissionState.current.loaded = true;
		})
		.catch(() => (permissionState.current.loaded = true));
}

/** 选了新预设：danger 走确认框，其余直接落盘 */
export function selectPermission(preset: string): void {
	if (preset === permissionState.current.preset) return;
	if (preset === 'danger-full-access') {
		permissionState.current.confirming = true;
		permissionState.current.confirmChecked = false;
		permissionState.current.pending = preset;
		return;
	}
	void commitPermission(preset);
}

async function commitPermission(preset: string): Promise<void> {
	const api = (window as unknown as { texpileAgent?: { permissionSet?: (s: string) => Promise<{ ok?: boolean }> } }).texpileAgent;
	if (!api?.permissionSet) return;
	try {
		const r = await api.permissionSet(preset);
		if (r?.ok) permissionState.current.preset = preset;
	} catch {
		/* 写盘失败：保持现状 */
	}
	// 权限预设只影响新建会话（DSH 设计如此）——"实时生效"的另一半：立即以新权限
	// 重建当前对话（fresh），用户不必再手动开新对话。旧会话在 DSH 侧栏仍可回看。
	try {
		const { agentSession, restartAgentSession } = await import('./agentSession.svelte');
		if (agentSession.chat || agentSession.state === 'ready') await restartAgentSession(undefined, { fresh: true });
	} catch {
		/* 无活动会话（面板尚未 start）：无需重建 */
	}
}

/** 确认框的两个动作 */
export function confirmDanger(): void {
	const pending = permissionState.current.pending ?? 'danger-full-access';
	permissionState.current.confirming = false;
	permissionState.current.pending = null;
	void commitPermission(pending);
}

export function cancelDanger(): void {
	permissionState.current.confirming = false;
	permissionState.current.pending = null;
}
