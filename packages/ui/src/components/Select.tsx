import * as RadixSelect from '@radix-ui/react-select'
import { ChevronDown, Check } from 'lucide-react'
import type { ReactNode } from 'react'

export const Select = RadixSelect.Root
export const SelectValue = RadixSelect.Value
export const SelectItemText = RadixSelect.ItemText

export function SelectTrigger({ children }: { children: ReactNode }) {
  return (
    <RadixSelect.Trigger className="select-trigger">
      {children}
      <RadixSelect.Icon>
        <ChevronDown size={16} strokeWidth={1.75} color="var(--ink-2)" />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  )
}

export function SelectContent({ children }: { children: ReactNode }) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content className="popover-content">
        <RadixSelect.Viewport>{children}</RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  )
}

export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixSelect.Item className="menu-item" value={value}>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator>
        <Check size={14} strokeWidth={1.75} />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  )
}
