export interface ProviderModelRef {
	provider: string;
	modelId: string;
}

/** Split a provider-qualified model reference while preserving slashes in the model ID. */
export function splitProviderModelRef(ref: string): ProviderModelRef | undefined {
	const slashIndex = ref.indexOf('/');
	if (slashIndex <= 0 || slashIndex === ref.length - 1) return undefined;

	return {
		provider: ref.slice(0, slashIndex),
		modelId: ref.slice(slashIndex + 1),
	};
}
