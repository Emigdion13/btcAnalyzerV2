import { createTa } from './indicator-runtime'
import type { Candle, ScriptResult } from './types'

const MAX_SOURCE_LENGTH = 40000
const TIMEOUT = 2200

export function validateScriptResult(value: unknown, candleCount: number): ScriptResult {
  const invalid = () => {
    throw new Error('The script returned an invalid or oversized result.')
  }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as ScriptResult
  if (
    !Array.isArray(result.plots) ||
    result.plots.length < 1 ||
    result.plots.length > 8 ||
    !Array.isArray(result.inputs) ||
    result.inputs.length > 30 ||
    !Number.isFinite(result.duration) ||
    result.duration < 0 ||
    result.duration > 10000
  )
    return invalid()
  for (const plot of result.plots) {
    if (
      !plot ||
      !Array.isArray(plot.values) ||
      plot.values.length !== candleCount ||
      plot.values.some(
        (v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e15),
      ) ||
      typeof plot.title !== 'string' ||
      !plot.title.length ||
      plot.title.length > 80 ||
      typeof plot.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(plot.color) ||
      !['price', 'oscillator'].includes(plot.pane) ||
      ![1, 2, 3, 4].includes(plot.lineWidth)
    )
      return invalid()
  }
  const names = new Set<string>()
  for (const input of result.inputs) {
    if (
      !input ||
      typeof input.name !== 'string' ||
      !input.name.length ||
      input.name.length > 80 ||
      names.has(input.name) ||
      !Number.isFinite(input.value) ||
      !Number.isFinite(input.min) ||
      !Number.isFinite(input.max) ||
      input.value < input.min ||
      input.value > input.max ||
      input.min > input.max
    )
      return invalid()
    names.add(input.name)
  }
  return result
}

/**
 * Scripts run in a fresh worker inside a sandboxed, opaque-origin iframe.
 * CSP denies network and external resources. The parent can always terminate
 * runaway execution by removing the iframe. Only a dedicated MessagePort is used
 * for results; no script code is evaluated in the application window.
 */
export function runIndicator(
  source: string,
  candles: Candle[],
  values: Record<string, number> = {},
  signal?: AbortSignal,
): Promise<ScriptResult> {
  if (source.length > MAX_SOURCE_LENGTH)
    return Promise.reject(new Error('Keep scripts under 40,000 characters.'))
  if (!candles.length) return Promise.reject(new Error('No candles available.'))
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))

  const workerSource = `
    const ta = (${createTa.toString()})();
    self.onmessage = function(event) {
      const port = event.ports[0];
      const started = performance.now();
      try {
        const { source, candles, values } = event.data;
        const plots = [], inputs = [];
        const input = { number(name, fallback, min = 1, max = 2000) {
          if (inputs.length >= 30) throw new Error('Use at most 30 inputs.');
          if (typeof name !== 'string' || !name.length || name.length > 80) throw new Error('Input names must be 1–80 characters.');
          if (inputs.some(i => i.name === name)) throw new Error('Input names must be unique: ' + name);
          const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
          if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || value < min || value > max) throw new Error(name + ' must be between ' + min + ' and ' + max + '.');
          inputs.push({ name, value, min, max });
          return value;
        }};
        const plot = (data, options = {}) => {
          if (plots.length >= 8) throw new Error('Use at most 8 plots per script.');
          if (!Array.isArray(data) || data.length !== candles.length) throw new Error('Each plot must return one value per candle (' + candles.length + ').');
          if (data.some(v => v !== null && (!Number.isFinite(v) || Math.abs(v) > 1e15))) throw new Error('Plot values must be finite numbers or null.');
          const color = typeof options.color === 'string' && /^#[0-9a-f]{6}$/i.test(options.color) ? options.color : '#b9ee82';
          plots.push({ values: data, title: String(options.title || 'Plot ' + (plots.length + 1)).slice(0, 80), color, pane: options.pane === 'oscillator' ? 'oscillator' : 'price', lineWidth: [1, 2, 3, 4].includes(options.lineWidth) ? options.lineWidth : 2 });
        };
        const fn = new Function('open', 'high', 'low', 'close', 'volume', 'time', 'ta', 'plot', 'input', '"use strict";\\n' + source);
        fn(...['open', 'high', 'low', 'close', 'volume', 'time'].map(key => candles.map(c => c[key])), ta, plot, input);
        if (!plots.length) throw new Error('Nothing to display. Add a plot(values, options) call to your script.');
        port.postMessage({ ok: true, result: { plots, inputs, duration: performance.now() - started } });
      } catch(error) {
        port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally { port.close(); self.close(); }
    };
  `

  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.display = 'none'
    const token = crypto.randomUUID()
    const channel = new MessageChannel()
    let done = false
    const cleanup = () => {
      done = true
      clearTimeout(timer)
      window.removeEventListener('message', onReady)
      signal?.removeEventListener('abort', abort)
      channel.port1.close()
      frame.remove()
    }
    const abort = () => {
      if (!done) {
        cleanup()
        reject(new DOMException('Aborted', 'AbortError'))
      }
    }
    const timer = setTimeout(() => {
      if (!done) {
        cleanup()
        reject(
          new Error(
            'Execution stopped after 2 seconds. Check for infinite loops or expensive calculations.',
          ),
        )
      }
    }, TIMEOUT)
    const onReady = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.token !== token ||
        event.data?.type !== 'ready'
      )
        return
      frame.contentWindow?.postMessage({ source, candles, values }, '*', [channel.port2])
    }
    channel.port1.onmessage = (event: MessageEvent) => {
      if (done) return
      cleanup()
      try {
        if (event.data?.ok) resolve(validateScriptResult(event.data.result, candles.length))
        else
          reject(
            new Error(
              String(event.data?.error ?? 'The script could not be evaluated.').slice(0, 600),
            ),
          )
      } catch (error) {
        reject(error)
      }
    }
    window.addEventListener('message', onReady)
    signal?.addEventListener('abort', abort, { once: true })
    frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none';"></head><body><script>
      const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSource).replace(/</g, '\\u003c')}], { type: 'text/javascript' })));
      window.addEventListener('message', function(event) {
        if (event.source !== parent || !event.ports[0]) return;
        worker.postMessage(event.data, [event.ports[0]]);
      }, { once: true });
      parent.postMessage({ type: 'ready', token: ${JSON.stringify(token)} }, '*');
    </script></body></html>`
    document.body.appendChild(frame)
  })
}
