const sampleRate = 24000;
const frameSamples = sampleRate / 100; // 10 ms of mono PCM16

export function youtubeSpeechBounds(pcm: Buffer) {
  const samples = pcm.length / 2;
  let first = samples, last = 0;
  for (let start = 0; start < samples; start += frameSamples) {
    const end = Math.min(samples, start + frameSamples);
    let sum = 0;
    for (let i = start; i < end; i++) sum += pcm.readInt16LE(i * 2) ** 2;
    if (sum > 100 ** 2 * (end - start)) {
      first = Math.min(first, start);
      last = end;
    }
  }
  return last ? { first, last } : undefined;
}

/** Keep breaths and consonants. Top up only the quiet time that the take is missing. */
export function paceYouTubeSpeech(pcm: Buffer, durations: number[], narration: string[]) {
  if (durations.length !== narration.length || !durations.length) throw new Error('Batas narasi belum lengkap.');
  let offset = 0;
  const parts: Buffer[] = [];
  const sceneDurations = durations.map((seconds, index) => {
    const size = 2 * Math.round(seconds * sampleRate);
    if (!Number.isSafeInteger(size) || size <= 0 || offset + size > pcm.length) throw new Error('Durasi ucapan tidak sesuai rekaman.');
    const take = pcm.subarray(offset, offset + size);
    offset += size;
    const samples = size / 2;
    const bounds = youtubeSpeechBounds(take);
    if (!bounds) throw new Error('Narasi tidak terdengar pada rekaman.');
    const { first, last } = bounds;
    // Let the new picture settle before the next thought and give questions more room.
    const lead = Math.max(0, Math.round(sampleRate * .32) - first);
    const tailSeconds = index === narration.length - 1 ? .68 : /[?!…][”"']?$/u.test(narration[index].trim()) ? .64 : .48;
    const tail = Math.max(0, Math.round(sampleRate * tailSeconds) - (samples - last));
    parts.push(Buffer.alloc(lead * 2), take, Buffer.alloc(tail * 2));
    return (lead + samples + tail) / sampleRate;
  });
  if (offset !== pcm.length) throw new Error('Sebagian ucapan belum mendapat gambar.');
  return { pcm: Buffer.concat(parts), sceneDurations };
}
