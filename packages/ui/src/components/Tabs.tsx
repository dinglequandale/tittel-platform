import * as RadixTabs from '@radix-ui/react-tabs'

export const Tabs = RadixTabs.Root
export const TabsContent = RadixTabs.Content

export function TabsList(props: RadixTabs.TabsListProps) {
  return <RadixTabs.List className="tabs-list" {...props} />
}

export function TabsTrigger(props: RadixTabs.TabsTriggerProps) {
  return <RadixTabs.Trigger className="tabs-trigger" {...props} />
}
