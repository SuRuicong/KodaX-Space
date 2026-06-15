// Resolve the model to show/use for the active provider (provider/model picker).
//
// Why this is its own validated function: `pendingModel` is PERSISTED across
// restarts (localStorage) but `pendingProviderId` is NOT — so on boot a stale
// model (e.g. 'glm-5.2' from a prior Zhipu session) can pair with a different
// restored/default provider (e.g. MiMo) and render "MiMo Coding · glm-5.2", a
// provider/model mismatch (recurring user-reported bug). The fix: a candidate is
// only usable if it actually belongs to the active provider. Pure → unit-tested.

export interface ResolveActiveModelInput {
  activeProviderId: string | null;
  /** The active provider's known model list (from provider.list). */
  activeProviderModels: readonly string[] | undefined;
  /** The active provider's default model. */
  activeProviderDefaultModel: string | undefined;
  /** User's pending (next-session) model — persisted, must be validated. */
  pendingModel: string | null | undefined;
  /** KodaX user-config default provider + model (paired). */
  kodaxDefaultsProvider: string | null | undefined;
  kodaxDefaultsModel: string | null | undefined;
}

export function resolveActiveModel(input: ResolveActiveModelInput): string {
  const belongsToActive = (m: string | null | undefined): m is string =>
    !!m &&
    ((input.activeProviderModels?.includes(m) ?? false) || m === input.activeProviderDefaultModel);

  // 1) pendingModel — only if it belongs to the active provider (guards the
  //    persisted-model-vs-restored-provider desync).
  if (belongsToActive(input.pendingModel)) return input.pendingModel;
  // 2) kodaxDefaults.model — only if its provider IS the active one (the config
  //    pairs them; using it under a different provider is the same mismatch class).
  if (
    input.kodaxDefaultsProvider != null &&
    input.kodaxDefaultsProvider === input.activeProviderId &&
    input.kodaxDefaultsModel
  ) {
    return input.kodaxDefaultsModel;
  }
  // 3) the active provider's own default model — always consistent with the provider.
  return input.activeProviderDefaultModel ?? '—';
}
