import { describe, expect, it } from 'vitest';
import { formatMediaInfo, guessMediaInfo, parseMediaInfo } from '../../src/core/subtitles/media-info';

describe('parseMediaInfo', () => {
  it.each([
    ['Maple.Street.S01E03.720p.srt', { title: 'Maple Street', season: 1, episode: 3 }],
    ['maple_street_s2e11.vtt', { title: 'maple street', season: 2, episode: 11 }],
    ['Maple Street 1x02.srt', { title: 'Maple Street', season: 1, episode: 2 }],
    ['Maple Street - Season 1 Episode 2', { title: 'Maple Street', season: 1, episode: 2 }],
    ['Harbour Lights (2019) S03E01', { title: 'Harbour Lights', season: 3, episode: 1, year: 2019 }],
    ['Quiet.Film.2021.1080p.srt', { year: 2021 }],
  ])('%s', (input, expected) => {
    expect(parseMediaInfo(input)).toEqual(expected);
  });
});

describe('guessMediaInfo', () => {
  it('prefers the file name and fills gaps from the page title', () => {
    expect(guessMediaInfo('S01E03.srt', 'Maple Street (2020) | Some Site')).toEqual({
      season: 1,
      episode: 3,
      year: 2020,
      title: 'Maple Street (2020)',
    });
  });

  it('uses the first title segment when nothing matches', () => {
    expect(guessMediaInfo(undefined, 'A Quiet Film | Watch')).toEqual({ title: 'A Quiet Film' });
  });
});

describe('formatMediaInfo', () => {
  it('formats show, episode and year', () => {
    expect(formatMediaInfo({ title: 'Maple Street', season: 1, episode: 3, year: 2020 })).toBe(
      'Maple Street S01E03 (2020)',
    );
  });
});
