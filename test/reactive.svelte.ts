/** Deeply reactive copy, like a parent's `$state` passed with `bind:`. */
export function reactive<T>(value: T): T {
  const s = $state(value);
  return s;
}
