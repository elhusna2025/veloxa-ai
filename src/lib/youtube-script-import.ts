import { longVideoPassages, scriptWords, type YouTubeProductionSettings, type YouTubeScriptBlock } from './youtube-production';

export const importExample = 'Menit 1 — Awal perjalanan\nNarator: Pagi itu, Nisa membuka tokonya untuk pertama kali.\n\nMenit 2 — Keputusan Nisa\nNarator: Saat pesanan pertama datang, ia harus memilih.';

const segmenter = new Intl.Segmenter('id', { granularity: 'sentence' });
const excerpt = (value: string, size: number) => value.length <= size ? value : value.slice(0, size - 1).trimEnd() + '…';

export function parseYouTubeScript(text: string, cast: YouTubeProductionSettings['characters'] = [], kind?: YouTubeProductionSettings['kind']) {
  if (!text.trim()) throw new Error('Tempel naskah yang ingin ditinjau.');
  const blocks: YouTubeScriptBlock[] = [];
  const speakers = new Map(cast.map(actor => [actor.name.trim().toLowerCase(), actor.id]));
  let block: YouTubeScriptBlock | undefined;
  let speakerId = 'narrator';
  let paragraph: string[] = [];
  function flush() {
    if (!paragraph.length || !block) return;
    const spoken = paragraph.join(' ');
    const passages: string[] = [];
    let passage = '';
    for (const sentence of segmenter.segment(spoken)) {
      const words = sentence.segment.trim();
      if (words.length > 650) throw new Error(`Menit ${block.index + 1} memiliki kalimat terlalu panjang. Pisahkan dengan titik atau baris kosong.`);
      if (passage && (passage.split(/\s+/u).length >= 24 || passage.length + 1 + words.length > 650)) {
        passages.push(passage);
        passage = '';
      }
      passage = passage ? passage + ' ' + words : words;
    }
    if (passage) passages.push(passage);
    for (const narration of passages) {
      block.scenes.push({ title: excerpt(narration, 48), supporting: excerpt(narration, 110), narration,
        lines: [{ speakerId, text: narration }], characterIds: speakerId === 'narrator' ? [] : [speakerId],
        visual: 'Ilustrasikan isi narasi berikut. ' + narration });
    }
    paragraph = [];
  }
  function start(minute: number, chapter: string) {
    flush();
    if (minute !== blocks.length + 1) throw new Error(`Urutkan penanda mulai Menit 1. Bagian berikutnya seharusnya Menit ${blocks.length + 1}.`);
    if (minute > 120) throw new Error('Durasi video maksimal 120 menit.');
    block = { index: minute - 1, chapter: chapter || `Bagian ${minute}`, scenes: [] };
    blocks.push(block);
    speakerId = 'narrator';
  }
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim().replace(/^\*\*([^:*]+):\*\*\s*/u, '$1: ');
    if (!line) { flush(); continue; }
    const header = line.replace(/^#{1,6}\s+/u, '').replace(/\*\*/gu, '');
    const numbered = /^menit\s+(\d{1,3})(?:\s*[:–—-]\s*(.*))?$/iu.exec(header);
    const timed = /^\[?(\d{1,3}):(\d{2})\s*[-–—]\s*(\d{1,3}):(\d{2})\]?(?:\s*[:–—-]?\s+(.*))?$/u.exec(header);
    if (numbered) { start(Number(numbered[1]), numbered[2]?.trim() || ''); continue; }
    if (timed) {
      if (timed[2] !== '00' || timed[4] !== '00' || Number(timed[3]) !== Number(timed[1]) + 1)
        throw new Error('Gunakan satu rentang per menit, misalnya 00:00–01:00. Urutan gambar di dalamnya mengikuti narasi.');
      start(Number(timed[1]) + 1, timed[5]?.trim() || ''); continue;
    }
    if (/^(?:menit\s+\d|\[?\d+:\d{2})/iu.test(header)) throw new Error('Tulis penanda di baris sendiri, misalnya Menit 1 atau 00:00–01:00.');
    if (!block) start(1, '');
    const label = /^([^:]{1,60}):\s*(.*)$/u.exec(line);
    if (label) {
      const name = label[1].replace(/\*\*/gu, '').trim().toLowerCase();
      if (name === 'visual') {
        flush();
        const scene = block!.scenes.at(-1);
        if (!scene || !label[2].trim() || label[2].length > 1150) throw new Error('Letakkan Visual: beserta arahan singkat setelah narasi adegannya.');
        scene.visual = 'Arahan gambar adegan: ' + label[2].trim();
        continue;
      }
      const speaker = /^(narator|narrator|voice over|vo)$/u.test(name) ? 'narrator' : speakers.get(name);
      if (speaker) { flush(); speakerId = speaker; if (label[2]) paragraph.push(label[2]); continue; }
    }
    paragraph.push(line);
  }
  flush();
  for (const item of blocks) {
    if (!item.scenes.length) throw new Error(`Isi narasi untuk Menit ${item.index + 1}.`);
    if (item.scenes.map(scene => scene.narration).join(' ').length > 4000)
      throw new Error(`Narasi Menit ${item.index + 1} terlalu panjang untuk satu menit. Bagi ke beberapa menit.`);
    if (kind === 'video') {
      const grouped: YouTubeScriptBlock['scenes'] = [];
      let lines: YouTubeScriptBlock['scenes'][number]['lines'] = [];
      const flushLines = () => {
        for (const passage of longVideoPassages(lines)) {
          const narration = passage.map(line => line.text).join(' ');
          const actors = passage.map(line => line.speakerId).filter(id => id !== 'narrator');
          grouped.push({ title: excerpt(narration, 48), supporting: excerpt(narration, 110), narration,
            lines: passage, characterIds: [...new Set(actors)], visual: 'Ilustrasikan isi narasi berikut. ' + narration });
        }
        lines = [];
      };
      for (const scene of item.scenes) {
        if (scene.visual.startsWith('Arahan gambar adegan: ')) {
          flushLines();
          grouped.push(scene);
        } else lines.push(...scene.lines);
      }
      flushLines();
      item.scenes = grouped;
    }
  }
  return blocks;
}

export function importPacingIssue(blocks: YouTubeScriptBlock[]) {
  for (const block of blocks) {
    const words = scriptWords(block.scenes);
    if (words < 105 || words > 125) return `Menit ${block.index + 1} berisi ${words} kata. Untuk produksi dengan durasi satu menit per bagian, sesuaikan menjadi 105–125 kata lewat Edit menit ${block.index + 1}.`;
  }
  return '';
}
