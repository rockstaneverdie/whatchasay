<script lang="ts">
  import { onMount } from 'svelte';
  import type { SavedPhrase } from '../../core/storage/idb';
  import { deletePhrase, listPhrases, phrasesToCsv } from '../../core/storage/phrases';
  import type { PageKey } from '../../i18n/pages';
  import { download } from './download';

  interface Props {
    t: (key: PageKey, params?: Record<string, string | number>) => string;
    typeLabel: (type: string) => string;
  }

  let { t, typeLabel }: Props = $props();

  let items = $state<SavedPhrase[]>([]);
  let query = $state('');

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) =>
      [p.phrase, p.cueText, p.explanation, p.show].some((s) => s.toLowerCase().includes(q)),
    );
  });

  onMount(() => {
    void listPhrases().then((p) => (items = p));
  });

  async function remove(id: number | undefined) {
    if (id === undefined) return;
    await deletePhrase(id);
    items = items.filter((p) => p.id !== id);
  }

  function exportCsv() {
    download(
      `whatchasay-phrases-${new Date().toISOString().slice(0, 10)}.csv`,
      phrasesToCsv(filtered),
      'text/csv',
    );
  }

  const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<section>
  <div class="bar">
    <input
      type="search"
      placeholder={t('opt.phrases.search')}
      aria-label={t('opt.phrases.search')}
      bind:value={query}
    />
    <button type="button" class="primary" onclick={exportCsv} disabled={filtered.length === 0}
      >{t('opt.phrases.export')}</button
    >
  </div>

  {#if items.length === 0}
    <p class="muted">{t('opt.phrases.empty')}</p>
  {:else}
    <ul>
      {#each filtered as p (p.id)}
        <li>
          <div class="head">
            <strong>{p.phrase}</strong>
            <span class="chip">{typeLabel(p.type)}</span>
            <span class="muted">{p.show} · {time(p.time)}</span>
            <button type="button" class="del" onclick={() => remove(p.id)}>{t('opt.phrases.delete')}</button>
          </div>
          {#if p.cueText !== p.phrase}<p class="cue">“{p.cueText}”</p>{/if}
          <p>{p.explanation.replace(/\*\*/g, '')}</p>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section {
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
  }

  .bar {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .bar input {
    flex: 1;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }

  .chip {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
  }

  .del {
    margin-left: auto;
    font-size: 13px;
  }

  p {
    margin: 4px 0 0;
  }

  .cue {
    color: var(--muted);
    font-style: italic;
  }
</style>
