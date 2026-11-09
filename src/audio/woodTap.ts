export function woodTapSamples(sampleRate: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.ceil(sampleRate * 0.18));
  let seed = 17321, softNoise = 0, softerNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    softNoise += (1 - Math.exp(-2 * Math.PI * 900 / sampleRate)) * (noise - softNoise);
    softerNoise += (1 - Math.exp(-2 * Math.PI * 280 / sampleRate)) * (softNoise - softerNoise);
    const attack = 1 - Math.exp(-t / 0.003);
    const bodyTime = Math.max(0, t - 0.0015);
    const body = (1 - Math.exp(-bodyTime / 0.002)) * (
      0.19 * Math.sin(2 * Math.PI * 330 * bodyTime) * Math.exp(-bodyTime / 0.009)
      + 0.035 * Math.sin(2 * Math.PI * 670 * bodyTime) * Math.exp(-bodyTime / 0.005));
    const contact = (softNoise - softerNoise) * 0.18 * Math.exp(-t / 0.005);
    const felt = softerNoise * 0.24 * Math.exp(-t / 0.024);
    const fade = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.01));
    samples[i] = (body + contact + felt) * attack * fade;
  }
  const peak = samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  for (let i = 0; i < samples.length; i++) samples[i] *= 0.13 / peak;
  return samples;
}
