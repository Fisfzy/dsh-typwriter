export type AccessLevel = 'owner' | 'editor' | 'viewer' | null;

// offline this stays null (never a viewer); kept so isReadOnly has a stable backing value
const userAccessLevel: AccessLevel = null;

export const isReadOnly = {
	get current(): boolean {
		return (userAccessLevel as AccessLevel) === 'viewer';
	}
};
