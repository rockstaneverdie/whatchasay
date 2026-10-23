<script lang="ts">
  // From brand/mark-black.svg, fills set to currentColor. Without a label it is decorative.
  let { class: cls = '', label }: { class?: string; label?: string } = $props();
</script>

<svg
  class={cls}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 128 128"
  ><g transform="translate(-16.00 -3.50) scale(1.2500)"
    ><path
      d="M28 46L52 50.5M72 42A14 14 0 1 1 95.9 49.9C91 53 86 55 86 60"
      fill="none"
      stroke="currentColor"
      stroke-width="8"
      stroke-linecap="round"
      stroke-linejoin="round"
    /><circle cx="40" cy="78" r="8" fill="currentColor" /><circle
      cx="86"
      cy="78"
      r="8"
      fill="currentColor"
    /></g
  ></svg
>
