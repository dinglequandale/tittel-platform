import * as RadixPopover from '@radix-ui/react-popover'
import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'

export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger

export function PopoverContent({ children }: { children: ReactNode }) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content className="popover-content" sideOffset={6}>
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
}

export const Menu = RadixMenu.Root
export const MenuTrigger = RadixMenu.Trigger

export function MenuContent({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content className="menu-content" sideOffset={6}>
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  )
}

export function MenuItem(props: RadixMenu.DropdownMenuItemProps) {
  return <RadixMenu.Item className="menu-item" {...props} />
}
