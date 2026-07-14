import { Tabs, TabsList, TabsTrigger, TabsContent } from '@tittel/ui'
import { ProblemsTab } from './ProblemsTab.tsx'
import { SetsTab } from './SetsTab.tsx'
import { LessonsTab } from './LessonsTab.tsx'
import { TagsTab } from './TagsTab.tsx'

export function ContentPage() {
  return (
    <div>
      <div className="page-toolbar">
        <h1>Content</h1>
      </div>
      <Tabs defaultValue="problems">
        <TabsList>
          <TabsTrigger value="problems">Problems</TabsTrigger>
          <TabsTrigger value="sets">Sets</TabsTrigger>
          <TabsTrigger value="lessons">Lessons</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
        <TabsContent value="problems"><ProblemsTab /></TabsContent>
        <TabsContent value="sets"><SetsTab /></TabsContent>
        <TabsContent value="lessons"><LessonsTab /></TabsContent>
        <TabsContent value="tags"><TagsTab /></TabsContent>
      </Tabs>
    </div>
  )
}
