export function woodTapSamples(sampleRate: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.ceil(sampleRate * 0.18));
  let seed = 17321, softNoise = 0, softerNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    softNoise += (1 - Math.exp(-2 * Math.PI * 1700 / sampleRate)) * (noise - softNoise);
    softerNoise += (1 - Math.exp(-2 * Math.PI * 420 / sampleRate)) * (softNoise - softerNoise);
    const attack = 1 - Math.exp(-t / 0.0012);
    const bodyTime = Math.max(0, t - 0.0015);
    const body = (1 - Math.exp(-bodyTime / 0.0008)) * (
      0.24 * Math.sin(2 * Math.PI * 560 * bodyTime) * Math.exp(-bodyTime / 0.0055)
      + 0.085 * Math.sin(2 * Math.PI * 1030 * bodyTime) * Math.exp(-bodyTime / 0.0035));
    const contact = (softNoise - softerNoise) * 0.55 * Math.exp(-t / 0.005);
    const felt = softerNoise * 0.11 * Math.exp(-t / 0.018);
    const fade = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.01));
    samples[i] = (body + contact + felt) * attack * fade;
  }
  const peak = samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  for (let i = 0; i < samples.length; i++) samples[i] *= 0.16 / peak;
  return samples;
}
