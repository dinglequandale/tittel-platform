import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@tittel/ui'
import { AnalyticsPage } from '../analytics/AnalyticsPage.tsx'
import { AssignmentsPage } from '../assignments/AssignmentsPage.tsx'

// Looking back across students (FLOW-SPEC §2.6): the overview, and every
// piece of homework as a gradebook. Giving homework normally happens on a
// lesson; the Homework tab is for browsing it all and for one-offs.
export function InsightsPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'homework' ? 'homework' : 'overview'
  return (
    <Tabs value={tab} onValueChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="homework">Homework</TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><AnalyticsPage /></TabsContent>
      <TabsContent value="homework"><AssignmentsPage /></TabsContent>
    </Tabs>
  )
}
