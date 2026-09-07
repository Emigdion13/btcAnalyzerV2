import { describe, expect, it } from 'vitest'
import { validateScriptResult } from './script-runner'
import type { ScriptResult } from './types'

const valid = (): ScriptResult => ({
  plots: [{ title: 'EMA', color: '#b9ee82', values: [null, 1, 2], pane: 'price', lineWidth: 2 }],
  inputs: [{ name: 'Period', value: 2, min: 1, max: 2000 }],
  duration: 1.2,
})
describe('worker result boundary', () => {
  it('accepts valid plots with warm-up gaps', () =>
    expect(validateScriptResult(valid(), 3)).toEqual(valid()))
  it('rejects a malformed result', () => {
    for (const value of [null, {}, { plots: [] }, 'fake', 42])
      expect(() => validateScriptResult(value, 3)).toThrow(/invalid/)
  })
  it('rejects an unexpected number of values', () =>
    expect(() => validateScriptResult(valid(), 4)).toThrow(/invalid/))
  it('rejects nonfinite values and CSS injection', () => {
    const values = valid()
    values.plots[0].values[0] = Infinity
    expect(() => validateScriptResult(values, 3)).toThrow(/invalid/)
    const css = valid()
    css.plots[0].color = 'url(https://example.com)'
    expect(() => validateScriptResult(css, 3)).toThrow(/invalid/)
  })
  it('enforces result cardinality and input-name uniqueness', () => {
    const plots = valid()
    plots.plots = Array(9).fill(plots.plots[0])
    expect(() => validateScriptResult(plots, 3)).toThrow(/invalid/)
    const inputs = valid()
    inputs.inputs.push(inputs.inputs[0])
    expect(() => validateScriptResult(inputs, 3)).toThrow(/invalid/)
  })
  it('rejects invalid inputs and timing metadata', () => {
    const inputs = valid()
    inputs.inputs[0].value = -1
    expect(() => validateScriptResult(inputs, 3)).toThrow(/invalid/)
    const duration = valid()
    duration.duration = NaN
    expect(() => validateScriptResult(duration, 3)).toThrow(/invalid/)
  })
})
