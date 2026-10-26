import { Tabs, TabsList, TabsTrigger, TabsContent } from '@tittel/ui'
import { ProblemsTab } from './ProblemsTab.tsx'
import { SetsTab } from './SetsTab.tsx'
import { LessonsTab } from './LessonsTab.tsx'
import { TagsTab } from './TagsTab.tsx'

export function ContentPage() {
  return (
    <div className="screen">
      <Tabs defaultValue="lessons">
        <TabsList>
          <TabsTrigger value="lessons">Plans</TabsTrigger>
          <TabsTrigger value="sets">Problem sets</TabsTrigger>
          <TabsTrigger value="problems">Problem bank</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
        <TabsContent value="lessons"><LessonsTab /></TabsContent>
        <TabsContent value="sets"><SetsTab /></TabsContent>
        <TabsContent value="problems"><ProblemsTab /></TabsContent>
        <TabsContent value="tags"><TagsTab /></TabsContent>
      </Tabs>
    </div>
  )
}
