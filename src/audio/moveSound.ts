import { woodTapSamples } from './woodTap';

let context: AudioContext | undefined;
let buffer: AudioBuffer | undefined;
const playing = new Map<AudioBufferSourceNode, GainNode>();
let lastStart = -Infinity;
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
  for (const [source, gain] of playing) {
    const now = context!.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.008);
    source.stop(now + 0.01);
  }
  lastStart = -Infinity;
}

export function playMoveSound() {
  revision++;
  prepareMoveSound();
  const audio = context, tap = buffer, current = revision;
  if (!audio || !tap) return;
  const start = () => {
    if (current !== revision || audio.state !== 'running') return;
    const now = audio.currentTime;
    if (now - lastStart < 0.11) return;
    lastStart = now;
    const source = audio.createBufferSource();
    source.buffer = tap;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.003);
    gain.gain.setValueAtTime(1, now + tap.duration - 0.012);
    gain.gain.linearRampToValueAtTime(0, now + tap.duration);
    source.connect(gain);
    gain.connect(audio.destination);
    playing.set(source, gain);
    source.onended = () => { playing.delete(source); source.disconnect(); gain.disconnect(); };
    source.start();
  };
  if (audio.state === 'running') start();
  else void audio.resume().then(start).catch(() => {});
}
