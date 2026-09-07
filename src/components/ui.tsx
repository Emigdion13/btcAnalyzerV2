import { useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bitcoin, Check, CheckCircle2, Info, X, AlertCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Asset } from '../lib/types'
import { sparklinePoints } from '../lib/market'

export function IconButton({
  icon: Icon,
  label,
  active,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={18} strokeWidth={1.65} />
    </button>
  )
}
export function CoinIcon({ asset, size = 28 }: { asset: Asset; size?: number }) {
  return (
    <span
      className={`coin-icon coin-${asset.ticker.toLowerCase()}`}
      style={
        {
          '--coin-color': asset.color,
          width: size,
          height: size,
          fontSize: Math.round(size * 0.66),
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {asset.ticker === 'BTC' ? (
        <Bitcoin size={size * 0.72} strokeWidth={1.9} />
      ) : asset.ticker === 'ETH' ? (
        <svg width={size * 0.55} height={size * 0.77} viewBox="0 0 20 32">
          <path d="m10 0 10 17-10 6L0 17z" fill="currentColor" opacity=".8" />
          <path d="m10 0 10 17-10-4z" fill="#c3cef8" />
          <path d="m0 19 10 6 10-6-10 13z" fill="currentColor" />
        </svg>
      ) : asset.ticker === 'SOL' ? (
        <svg width={size * 0.63} height={size * 0.63} viewBox="0 0 24 24">
          <path d="M6 3h17l-5 5H1z" fill="#9fc5b9" />
          <path d="M1 10h17l5 5H6z" fill="#b8a3e9" />
          <path d="M6 17h17l-5 5H1z" fill="#a695e1" />
        </svg>
      ) : (
        asset.icon
      )}
    </span>
  )
}
export function Sparkline({ asset, width = 66 }: { asset: Asset; width?: number }) {
  return (
    <svg
      width={width}
      height="30"
      viewBox="0 0 66 32"
      className={`sparkline ${asset.change >= 0 ? 'positive' : 'negative'}`}
      aria-hidden="true"
    >
      <polyline
        points={sparklinePoints(asset.symbol, asset.change >= 0)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}
export function Modal({
  title,
  description,
  children,
  onClose,
  className = '',
  footer,
  eyebrow,
}: {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  className?: string
  footer?: ReactNode
  eyebrow?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = ref.current
    const timer = setTimeout(() => {
      const auto = element?.querySelector<HTMLElement>('[data-autofocus]')
      ;(auto ?? element)?.focus()
    }, 30)
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)
      const first = focusable[0],
        last = focusable[focusable.length - 1]
      if (!first) {
        event.preventDefault()
        return
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === element)
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', keydown, true)
      previous?.focus()
    }
  }, [])
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-header">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton icon={X} label="Close dialog" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
export function Dropdown({
  trigger,
  children,
  align = 'left',
  className = '',
}: {
  trigger: (open: boolean) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <div onClick={() => setOpen(!open)}>{trigger(open)}</div>
      {open && (
        <div className={`dropdown-menu align-${align}`}>{children(() => setOpen(false))}</div>
      )}
    </div>
  )
}
export function MenuItem({
  children,
  onClick,
  icon: Icon,
  selected,
  shortcut,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  icon?: LucideIcon
  selected?: boolean
  shortcut?: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={`menu-item ${selected ? 'selected' : ''} ${danger ? 'danger' : ''}`}
      onClick={onClick}
    >
      {Icon && <Icon size={16} strokeWidth={1.6} />}
      <span>{children}</span>
      {selected && <Check size={14} />}
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  )
}
export interface ToastMessage {
  id: string
  message: string
  tone: 'success' | 'error' | 'info'
}
export function ToastHost({
  toasts,
  dismiss,
}: {
  toasts: ToastMessage[]
  dismiss: (id: string) => void
}) {
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.tone}`} key={toast.id}>
          {toast.tone === 'success' ? (
            <CheckCircle2 size={18} />
          ) : toast.tone === 'error' ? (
            <AlertCircle size={18} />
          ) : (
            <Info size={18} />
          )}
          <span>{toast.message}</span>
          <IconButton icon={X} label="Dismiss notification" onClick={() => dismiss(toast.id)} />
        </div>
      ))}
    </div>
  )
}
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  )
}
