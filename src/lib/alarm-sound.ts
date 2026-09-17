/**
 * The alarm chime.
 *
 * Deliberately dependency-free: two short Web Audio notes, synthesised at fire time, so nothing
 * is fetched and no asset is bundled. Browsers only allow audio after a user gesture, so the
 * workspace primes the context on the first click or key press and every call is best-effort —
 * when audio is unavailable the toast still lands and no exception ever escapes.
 */
import type { AlarmConditionId, IndicatorAlarm } from './types'

export type AlarmChime = 'bull' | 'bear' | 'neutral'
/** Rising for a trigger that suggests strength, falling for weakness, flat pair otherwise. */
const CHIME_NOTES: Record<AlarmChime, number[]> = {
  bull: [523.25, 783.99],
  bear: [587.33, 392.0],
  neutral: [587.33, 880.0],
}
/**
 * How each condition sounds. Read as "which way is this news for the price", using the pane's
 * own vocabulary: a lime/aqua MACD bar and a fear spike are the bullish readings, red and blue
 * the bearish ones.
 */
const CHIME_BY_CONDITION: Record<AlarmConditionId, AlarmChime> = {
  'macd-cross-up': 'bull',
  'macd-about-cross-up': 'bull',
  'macd-zero-cross-up': 'bull',
  'macd-above-level': 'bull',
  'macd-hist-rising': 'bull',
  'macd-hist-aqua': 'bull',
  'macd-cross-down': 'bear',
  'macd-about-cross-down': 'bear',
  'macd-zero-cross-down': 'bear',
  'macd-below-level': 'bear',
  'macd-hist-falling': 'bear',
  'macd-hist-blue': 'bear',
  // At or below zero and increasing: the sell-off itself is losing momentum.
  'macd-hist-maroon': 'bull',
  // At or below zero and decreasing: the sell-off is building.
  'macd-hist-red': 'bear',
  'rsi-cross-up-level': 'bull',
  'rsi-about-cross-up': 'bull',
  'rsi-above-level': 'bull',
  'rsi-turns-up': 'bull',
  'rsi-cross-down-level': 'bear',
  'rsi-about-cross-down': 'bear',
  'rsi-below-level': 'bear',
  'rsi-turns-down': 'bear',
  // A lime VIX Fix bar is the published market-bottom signal.
  'wvf-spike': 'bull',
  'wvf-about-spike': 'bull',
  'wvf-cross-above-band': 'bull',
  'wvf-cross-above-range': 'bull',
  'wvf-above-level': 'bull',
  'wvf-spike-ends': 'neutral',
  'wvf-below-level': 'neutral',
}
export function alarmChimeForCondition(condition: AlarmConditionId): AlarmChime {
  return CHIME_BY_CONDITION[condition] ?? 'neutral'
}
/**
 * The chime for a whole alarm. A combined alarm sounds like its legs when they agree; when a
 * bullish leg and a bearish leg share one trigger the news is genuinely two-sided, so it gets
 * the flat pair instead of picking a side for the trader.
 */
export function alarmChimeForAlarm(alarm: Pick<IndicatorAlarm, 'condition' | 'also'>): AlarmChime {
  const chimes = [
    alarmChimeForCondition(alarm.condition),
    ...(alarm.also ?? []).map((entry) => alarmChimeForCondition(entry.condition)),
  ]
  const unique = new Set(chimes)
  return unique.size === 1 ? chimes[0] : 'neutral'
}
type AudioContextConstructor = new () => AudioContext
function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor
    webkitAudioContext?: AudioContextConstructor
  }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}
let context: AudioContext | null = null
/** True when this browser can play the chime at all — the settings copy says so. */
export function alarmAudioAvailable(): boolean {
  return audioContextConstructor() !== null
}
/**
 * Create or resume the audio context. Called from the app's first user gesture; a suspended
 * context is normal until then, and every later call re-checks.
 */
export function primeAlarmAudio(): boolean {
  const Constructor = audioContextConstructor()
  if (!Constructor) return false
  try {
    if (!context) context = new Constructor()
    if (context.state === 'suspended') void context.resume().catch(() => {})
    return true
  } catch {
    context = null
    return false
  }
}
/**
 * Play the two-note chime. Returns whether anything was actually scheduled, which is what the
 * builder's Test button reports and what the unit tests assert on.
 */
export function playAlarmChime(chime: AlarmChime = 'neutral', volume = 0.18): boolean {
  const Constructor = audioContextConstructor()
  if (!Constructor) return false
  try {
    if (!context) context = new Constructor()
    if (context.state === 'suspended') void context.resume().catch(() => {})
    const notes = CHIME_NOTES[chime]
    const start = context.currentTime + 0.02
    notes.forEach((frequency, index) => {
      const at = start + index * 0.17
      const oscillator = context!.createOscillator()
      const gain = context!.createGain()
      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(frequency, at)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(volume, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3)
      oscillator.connect(gain)
      gain.connect(context!.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.32)
    })
    return true
  } catch {
    return false
  }
}
/** Test-only: drop the cached context so a stubbed AudioContext can be installed. */
export function resetAlarmAudio(): void {
  context = null
}
