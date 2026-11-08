// The models a preset agent offers, asked of it once per agent while the app runs; a failed ask is asked again
import { agentBridge, type AgentModel, type AgentModelList, type PresetAgent } from './selectionRefiner';

const asked = new Map<PresetAgent, Promise<AgentModelList>>();

export function agentModels(agent: PresetAgent): Promise<AgentModelList> {
	const known = asked.get(agent);
	if (known) return known;
	const bridge = agentBridge();
	const list: Promise<AgentModelList> = bridge
		? bridge.models(agent).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
		: Promise.resolve({ ok: false, error: 'not in the desktop app' });
	asked.set(agent, list);
	void list.then((l) => !l.ok && asked.delete(agent));
	return list;
}

/** Default first where the agent lists none of its own, and a saved model it no longer lists kept in view */
export function modelChoices(models: AgentModel[], chosen: string, defaultName: string): AgentModel[] {
	const out = models.some((m) => m.id === '') ? [...models] : [{ id: '', name: defaultName, description: '' }, ...models];
	if (!out.some((m) => m.id === chosen)) out.push({ id: chosen, name: chosen, description: '' });
	return out;
}
