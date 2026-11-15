use std::f64::consts::TAU;
use std::time::{Duration, Instant};

pub struct MoveSound {
    last: Option<Instant>,
    samples: Vec<f32>,
    #[cfg(windows)]
    output: Option<(rodio::OutputStream, rodio::Sink)>,
}

impl MoveSound {
    pub fn new() -> Self {
        Self {
            last: None,
            samples: wood_tap(48_000),
            #[cfg(windows)]
            output: None,
        }
    }

    pub fn play(&mut self, platform: &crate::platform::Platform) {
        if self
            .last
            .is_some_and(|time| time.elapsed() < Duration::from_millis(110))
        {
            return;
        }
        self.last = Some(Instant::now());
        #[cfg(windows)]
        {
            if self.output.is_none()
                && let Ok(stream) = rodio::OutputStreamBuilder::open_default_stream()
            {
                let sink = rodio::Sink::connect_new(stream.mixer());
                self.output = Some((stream, sink));
            }
            if let Some((_, sink)) = &self.output {
                sink.clear();
                sink.append(rodio::buffer::SamplesBuffer::new(
                    1,
                    48_000,
                    self.samples.clone(),
                ));
                sink.play();
            }
        }
        #[cfg(target_os = "android")]
        platform.play_tap(&self.samples);
        #[cfg(not(target_os = "android"))]
        let _ = platform;
    }
}

fn wood_tap(rate: u32) -> Vec<f32> {
    let sample_rate = f64::from(rate);
    let count = (sample_rate * 0.18).ceil() as usize;
    let mut seed = 17321_u32;
    let mut soft_noise = 0.0;
    let mut softer_noise = 0.0;
    let mut samples = Vec::with_capacity(count);
    let soft = 1.0 - (-TAU * 900.0 / sample_rate).exp();
    let softer = 1.0 - (-TAU * 280.0 / sample_rate).exp();
    for index in 0..count {
        let time = index as f64 / sample_rate;
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let noise = f64::from(seed) / 2147483648.0 - 1.0;
        soft_noise += soft * (noise - soft_noise);
        softer_noise += softer * (soft_noise - softer_noise);
        let attack = 1.0 - (-time / 0.003).exp();
        let body_time = (time - 0.0015).max(0.0);
        let body = (1.0 - (-body_time / 0.002).exp())
            * (0.19 * (TAU * 330.0 * body_time).sin() * (-body_time / 0.009).exp()
                + 0.035 * (TAU * 670.0 * body_time).sin() * (-body_time / 0.005).exp());
        let contact = (soft_noise - softer_noise) * 0.18 * (-time / 0.005).exp();
        let felt = softer_noise * 0.24 * (-time / 0.024).exp();
        let fade = ((count - 1 - index) as f64 / (sample_rate * 0.01)).min(1.0);
        samples.push(((body + contact + felt) * attack * fade) as f32);
    }
    let peak = samples.iter().map(|v| v.abs()).fold(0.0, f32::max);
    for (index, sample) in samples.iter_mut().enumerate() {
        let time = index as f64 / sample_rate;
        let gain = (time / 0.003)
            .min(1.0)
            .min(((0.18 - time) / 0.012).clamp(0.0, 1.0));
        *sample = (f64::from(*sample) * 0.13 / f64::from(peak) * gain) as f32;
    }
    samples
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v15_wood_tap() {
        let samples = wood_tap(48_000);
        assert_eq!(samples.len(), 8640);
        assert_eq!(samples[0], 0.0);
        assert_eq!(samples[8639], 0.0);
        assert!(
            (samples
                .iter()
                .map(|sample| sample.abs())
                .fold(0.0, f32::max)
                - 0.13)
                .abs()
                < 0.000_001
        );
        for (index, value) in [
            (32, 0.002967232),
            (240, 0.10993762),
            (650, -0.019777214),
            (1200, -0.005720950),
        ] {
            assert!((samples[index] - value).abs() < 0.000_001);
        }
    }
}
