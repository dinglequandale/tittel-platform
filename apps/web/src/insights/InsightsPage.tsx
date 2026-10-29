import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@tittel/ui'
import { AnalyticsPage } from '../analytics/AnalyticsPage.tsx'
import { AssignmentsPage } from '../assignments/AssignmentsPage.tsx'
import { HoursPage } from './HoursPage.tsx'

// Looking back across students (FLOW-SPEC §2.6): the overview, and every
// piece of homework as a gradebook, and hours taught per family for invoicing.
// Giving homework normally happens on a lesson; the Homework tab is for
// browsing it all and for one-offs.
export function InsightsPage() {
  const [params, setParams] = useSearchParams()
  const t = params.get('tab')
  const tab = t === 'homework' || t === 'hours' ? t : 'overview'
  return (
    <Tabs value={tab} onValueChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="homework">Homework</TabsTrigger>
        <TabsTrigger value="hours">Hours</TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><AnalyticsPage /></TabsContent>
      <TabsContent value="homework"><AssignmentsPage /></TabsContent>
      <TabsContent value="hours"><HoursPage /></TabsContent>
    </Tabs>
  )
}
