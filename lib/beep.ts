/**
 * Short sounds for kitchen screens and the pickup board (Web Audio, no
 * files). Browsers only play sound after someone has touched the page, so
 * screens call unlockSound() on the first tap; for unattended screens, start
 * Chrome with --autoplay-policy=no-user-gesture-required.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  context ??= new AudioContext();
  return context;
}

export function unlockSound() {
  const ctx = audio();
  if (ctx?.state === "suspended") void ctx.resume();
}

const TONES = {
  /** A new ticket. */
  new: [740],
  /** Something on a ticket was voided. */
  void: [880, 440, 880],
  /** An order is ready (pickup board). */
  ready: [660, 990],
} as const;

export function beep(kind: keyof typeof TONES) {
  try {
    const ctx = audio();
    if (!ctx || ctx.state !== "running") return;
    let at = ctx.currentTime;
    for (const frequency of TONES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.2);
      at += 0.22;
    }
  } catch {
    // No sound available: the screen still shows everything.
  }
}
