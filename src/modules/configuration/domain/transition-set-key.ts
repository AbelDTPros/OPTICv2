export function resolveTransitionSetKey(
  stage: { transitionSetKey?: string },
  action: { transitionSetKey?: string }
): string | undefined {
  const fromStage = stage.transitionSetKey?.trim();
  if (fromStage) {
    return fromStage;
  }
  const fromAction = action.transitionSetKey?.trim();
  return fromAction || undefined;
}
