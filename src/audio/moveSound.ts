import { woodTapSamples } from './woodTap';

let context: AudioContext | undefined;
let buffer: AudioBuffer | undefined;
const playing = new Set<AudioBufferSourceNode>();
let revision = 0;

export function prepareMoveSound() {
  try {
    if (!context || context.state === 'closed') {
      context = new AudioContext();
      const samples = woodTapSamples(context.sampleRate);
      buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.copyToChannel(samples, 0);
    }
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch {}
}

export function stopMoveSounds() {
  revision++;
  for (const source of playing) { source.stop(); source.disconnect(); }
  playing.clear();
}

export function playMoveSound() {
  revision++;
  prepareMoveSound();
  const audio = context, tap = buffer, current = revision;
  if (!audio || !tap) return;
  const start = () => {
    if (current !== revision || audio.state !== 'running') return;
    for (const source of playing) { source.stop(); source.disconnect(); }
    playing.clear();
    const source = audio.createBufferSource();
    source.buffer = tap;
    source.connect(audio.destination);
    playing.add(source);
    source.onended = () => { playing.delete(source); source.disconnect(); };
    source.start();
  };
  if (audio.state === 'running') start();
  else void audio.resume().then(start).catch(() => {});
}
