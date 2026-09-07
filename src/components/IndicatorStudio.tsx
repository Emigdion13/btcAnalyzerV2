import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowUpRight,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Code2,
  Download,
  Expand,
  Eye,
  EyeOff,
  FileCode2,
  FolderTree,
  Loader2,
  Maximize2,
  Play,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Table2,
  Trash2,
} from 'lucide-react'
import type { Candle, DataSource, Drawing, Indicator, SavedScript } from '../lib/types'
import { SCRIPT_TEMPLATES } from '../lib/indicators'
import { indicatorLabel } from '../lib/cm-ult-macd'
import { compactNumber, formatPrice } from '../lib/market'
import { Dropdown, IconButton, MenuItem } from './ui'

interface Props {
  name: string
  source: string
  onNameChange: (name: string) => void
  onSourceChange: (source: string) => void
  onRun: () => void
  onSave: () => void
  onTemplate: (name: string, source: string) => void
  scripts: SavedScript[]
  onLoadScript: (script: SavedScript) => void
  saved: boolean
  running: boolean
  status: { type: 'ready' | 'success' | 'error'; message: string }
  open: boolean
  onOpenChange: (open: boolean) => void
  height: number
  onHeightChange: (height: number) => void
  onDocs: () => void
  indicators: Indicator[]
  drawings: Drawing[]
  onIndicatorToggle: (id: string) => void
  onIndicatorRemove: (id: string) => void
  onIndicatorEdit: (indicator: Indicator) => void
  onDrawingRemove: (id: string) => void
  candles: Candle[]
  dataSource: DataSource
  onExportData: () => void
}
function highlighted(source: string): ReactNode[] {
  const pattern =
    /\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|return|if|else|for|while|true|false|null|new|throw)\b|\b\d+(?:\.\d+)?\b|\b(?:ta|plot|input|close|open|high|low|volume|time)\b/g
  let last = 0
  const nodes: ReactNode[] = []
  for (const match of source.matchAll(pattern)) {
    const index = match.index
    if (index > last) nodes.push(source.slice(last, index))
    const token = match[0]
    const type = token.startsWith('//')
      ? 'comment'
      : /^['"]/.test(token)
        ? 'string'
        : /^\d/.test(token)
          ? 'number'
          : /^(ta|plot|input|close|open|high|low|volume|time)$/.test(token)
            ? 'api'
            : 'keyword'
    nodes.push(
      <span className={`syntax-${type}`} key={index}>
        {token}
      </span>,
    )
    last = index + token.length
  }
  nodes.push(source.slice(last) + '\n')
  return nodes
}
export function IndicatorStudio(props: Props) {
  const { name, source, open, height } = props
  const [tab, setTab] = useState<'editor' | 'objects' | 'data'>('editor')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const numbersRef = useRef<HTMLDivElement>(null)
  const previousHeight = useRef(height)
  const setCursorPosition = () => {
    const position = textareaRef.current?.selectionStart ?? 0
    const before = source.slice(0, position).split('\n')
    setCursor({ line: before.length, column: before[before.length - 1].length + 1 })
  }
  const resize = (event: React.PointerEvent) => {
    event.preventDefault()
    const start = event.clientY,
      initial = height
    if (!open) props.onOpenChange(true)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    const move = (e: PointerEvent) =>
      props.onHeightChange(
        Math.min(window.innerHeight * 0.65, Math.max(190, initial + start - e.clientY)),
      )
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop, { once: true })
  }
  const activateTab = (next: typeof tab) => {
    setTab(next)
    props.onOpenChange(true)
  }
  return (
    <section
      className={`studio ${open ? 'open' : 'collapsed'}`}
      style={{ '--studio-height': `${height}px` } as CSSProperties}
      aria-label="Indicator Studio"
    >
      <div
        className="studio-resize"
        onPointerDown={resize}
        role="separator"
        aria-label="Resize indicator studio"
        aria-orientation="horizontal"
      />
      <div className="studio-tabs">
        <div className="studio-tab-list" role="tablist" aria-label="Workspace panels">
          <button
            role="tab"
            aria-selected={tab === 'editor'}
            className={tab === 'editor' ? 'active' : ''}
            onClick={() => activateTab('editor')}
          >
            <Code2 size={16} />
            Indicator Studio<span className="new-badge">BETA</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'objects'}
            className={tab === 'objects' ? 'active' : ''}
            onClick={() => activateTab('objects')}
          >
            <FolderTree size={15} />
            <span>Object tree</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'data'}
            className={tab === 'data' ? 'active' : ''}
            onClick={() => activateTab('data')}
          >
            <Table2 size={15} />
            <span>Data window</span>
          </button>
        </div>
        <div className="studio-window-actions">
          <IconButton
            icon={Maximize2}
            label="Expand indicator studio"
            onClick={() => {
              if (height > 340) props.onHeightChange(previousHeight.current)
              else {
                previousHeight.current = height
                props.onHeightChange(Math.min(470, window.innerHeight * 0.6))
              }
              props.onOpenChange(true)
            }}
          />
          <IconButton
            icon={open ? ChevronDown : ChevronUp}
            label={open ? 'Collapse indicator studio' : 'Open indicator studio'}
            onClick={() => props.onOpenChange(!open)}
          />
        </div>
      </div>
      {open && (
        <div className="studio-body" role="tabpanel">
          {tab === 'editor' ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-filename">
                  <FileCode2 size={15} />
                  <input
                    aria-label="Indicator script name"
                    value={name}
                    onChange={(e) => props.onNameChange(e.target.value)}
                    maxLength={60}
                  />
                  <span
                    className={`file-status ${props.saved ? 'saved' : ''}`}
                    title={props.saved ? 'Saved locally' : 'Unsaved changes'}
                  />
                  <Dropdown
                    trigger={() => (
                      <IconButton icon={ChevronDown} label="Open scripts and templates" />
                    )}
                  >
                    {(close) => (
                      <>
                        <div className="menu-label">START WITH A TEMPLATE</div>
                        {SCRIPT_TEMPLATES.map((template) => (
                          <MenuItem
                            key={template.name}
                            icon={Braces}
                            onClick={() => {
                              props.onTemplate(template.name, template.source)
                              close()
                            }}
                          >
                            {template.name}
                          </MenuItem>
                        ))}
                        <MenuItem
                          icon={Plus}
                          onClick={() => {
                            props.onTemplate(
                              'Untitled indicator',
                              '// Build something uniquely yours.\n\nplot(close, { title: "Close", color: "#b9ee82" });',
                            )
                            close()
                          }}
                        >
                          Blank script
                        </MenuItem>
                        {props.scripts.length > 0 && (
                          <>
                            <div className="menu-divider" />
                            <div className="menu-label">SAVED SCRIPTS</div>
                            {props.scripts.map((script) => (
                              <MenuItem
                                key={script.id}
                                icon={FileCode2}
                                onClick={() => {
                                  props.onLoadScript(script)
                                  close()
                                }}
                              >
                                {script.name}
                              </MenuItem>
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </Dropdown>
                </div>
                <div className="editor-actions">
                  <span className="language-badge">JavaScript</span>
                  <button className="button button-quiet save-script" onClick={props.onSave}>
                    <Save size={14} />
                    Save
                  </button>
                  <button
                    className="button button-run"
                    onClick={props.onRun}
                    disabled={props.running || !source.trim()}
                  >
                    {props.running ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Play size={13} fill="currentColor" />
                    )}
                    <span>{props.running ? 'Running…' : 'Add to chart'}</span>
                  </button>
                </div>
              </div>
              <div className="editor-main">
                <div className="code-editor">
                  <div className="line-numbers" aria-hidden="true" ref={numbersRef}>
                    {source.split('\n').map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <div className="code-layers">
                    <pre className="code-highlight" ref={preRef} aria-hidden="true">
                      <code>{highlighted(source)}</code>
                    </pre>
                    <textarea
                      ref={textareaRef}
                      className="code-input"
                      aria-label="Custom indicator JavaScript code"
                      value={source}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      wrap="off"
                      onChange={(event) => props.onSourceChange(event.target.value)}
                      onSelect={setCursorPosition}
                      onScroll={(event) => {
                        if (preRef.current) {
                          preRef.current.scrollTop = event.currentTarget.scrollTop
                          preRef.current.scrollLeft = event.currentTarget.scrollLeft
                        }
                        if (numbersRef.current)
                          numbersRef.current.scrollTop = event.currentTarget.scrollTop
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Tab') {
                          event.preventDefault()
                          const element = event.currentTarget,
                            start = element.selectionStart,
                            end = element.selectionEnd
                          props.onSourceChange(source.slice(0, start) + '  ' + source.slice(end))
                          requestAnimationFrame(() => {
                            element.selectionStart = element.selectionEnd = start + 2
                          })
                        }
                      }}
                      maxLength={40000}
                    />
                  </div>
                </div>
                <aside className="editor-inspiration">
                  <div className="inspiration-title">
                    <span>
                      <Braces size={19} />
                    </span>
                    <Sparkles size={14} />
                  </div>
                  <h3>
                    A little code.
                    <br />
                    An entirely new perspective.
                  </h3>
                  <p>
                    Build your own indicators.
                    <br />
                    Make the chart work for you.
                  </p>
                  <button className="text-button" onClick={props.onDocs}>
                    Explore the docs <ArrowUpRight size={13} />
                  </button>
                </aside>
              </div>
              <div className={`editor-status ${props.status.type}`}>
                <span className="editor-message" title={props.status.message}>
                  {props.running ? (
                    <Loader2 size={11} className="spin" />
                  ) : props.status.type === 'success' ? (
                    <Check size={12} />
                  ) : props.status.type === 'error' ? (
                    <Circle size={8} fill="currentColor" />
                  ) : (
                    <span className="tiny-dot" />
                  )}
                  {props.running ? 'Running in an isolated worker…' : props.status.message}
                </span>
                <div>
                  <span>
                    Ln {cursor.line}, Col {cursor.column}
                  </span>
                  <span>UTF-8</span>
                  <span className="worker-label">
                    <span className="tiny-dot gray" />
                    Worker-powered
                  </span>
                </div>
              </div>
            </>
          ) : tab === 'objects' ? (
            <div className="object-tree">
              <div className="object-column">
                <div className="object-section-heading">
                  INDICATORS <span>{props.indicators.length}</span>
                </div>
                {props.indicators.map((indicator) => (
                  <div className="object-row" key={indicator.id}>
                    <span className="legend-dot" style={{ background: indicator.color }} />
                    <span>
                      {indicatorLabel(indicator)}
                      {indicator.kind === 'custom' && <em>Custom</em>}
                    </span>
                    <div>
                      <IconButton
                        icon={indicator.visible ? Eye : EyeOff}
                        label={`Toggle ${indicator.name} visibility`}
                        onClick={() => props.onIndicatorToggle(indicator.id)}
                      />
                      <IconButton
                        icon={Settings2}
                        label={`Edit ${indicator.name}`}
                        onClick={() => props.onIndicatorEdit(indicator)}
                      />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${indicator.name}`}
                        onClick={() => props.onIndicatorRemove(indicator.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="object-column">
                <div className="object-section-heading">
                  DRAWINGS <span>{props.drawings.length}</span>
                </div>
                {props.drawings.length ? (
                  props.drawings.map((drawing) => (
                    <div className="object-row" key={drawing.id}>
                      <Expand size={13} />
                      <span className="capitalize">
                        {drawing.tool === 'text' ? drawing.text : drawing.tool}
                        <small>{formatPrice(drawing.start.price)}</small>
                      </span>
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${drawing.tool} drawing`}
                        onClick={() => props.onDrawingRemove(drawing.id)}
                      />
                    </div>
                  ))
                ) : (
                  <div className="object-empty">
                    <FolderTree size={24} />
                    <span>A home for your ideas.</span>
                    <p>Draw on the chart to see your objects here.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="data-window">
              <div className="data-window-header">
                <span>
                  OHLCV data{' '}
                  <em>
                    {props.candles.length}{' '}
                    {props.dataSource === 'coinbase' ? 'Coinbase' : 'simulated'} bars · UTC
                  </em>
                </span>
                <button className="button button-quiet" onClick={props.onExportData}>
                  <Download size={13} />
                  Export CSV
                </button>
              </div>
              <div className="data-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {['Time (UTC)', 'Open', 'High', 'Low', 'Close', 'Volume'].map((text) => (
                        <th key={text}>{text}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {props.candles
                      .slice(-150)
                      .reverse()
                      .map((candle) => (
                        <tr key={candle.time}>
                          <td>
                            {new Date(candle.time * 1000)
                              .toISOString()
                              .slice(0, 16)
                              .replace('T', ' ')}
                          </td>
                          <td>{formatPrice(candle.open)}</td>
                          <td>{formatPrice(candle.high)}</td>
                          <td>{formatPrice(candle.low)}</td>
                          <td className={candle.close >= candle.open ? 'positive' : 'negative'}>
                            {formatPrice(candle.close)}
                          </td>
                          <td>{compactNumber(candle.volume)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
