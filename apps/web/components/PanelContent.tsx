'use client';

import type { ReactNode } from 'react';
import type { PanelState } from '../lib/panels';
import { ActionItems } from './ActionItems';
import { ApprovalsInbox } from './ApprovalsInbox';
import { BriefView } from './BriefView';
import { CampaignsView } from './CampaignsView';
import { DepartmentBoard, DepartmentChannel } from './DepartmentPanels';
import { GoalsView } from './GoalsView';
import { HealthView } from './HealthView';
import { IdeasView } from './IdeasView';
import { InboxView } from './InboxView';
import { PipelineView } from './PipelineView';
import { PushToggle } from './PushToggle';
import { SignalsView } from './SignalsView';
import { TasksView } from './TasksView';

/** What is inside each panel: the page components as they were, one per panel id. */
export function PanelContent(state: PanelState): ReactNode {
  switch (state.id) {
    case 'tasks':
      return <TasksView />;
    case 'run-log':
      return <TasksView taskId={state.task} only />;
    case 'department-board':
      return <DepartmentBoard dept={state.dept ?? ''} />;
    case 'department-meeting':
      return <DepartmentChannel dept={state.dept ?? ''} />;
    case 'approvals':
      return <ApprovalsInbox />;
    case 'needs-you':
      return <ActionItems />;
    case 'brief':
      return <BriefView />;
    case 'inbox':
      return <InboxView />;
    case 'pipeline':
      return <PipelineView />;
    case 'campaigns':
      return <CampaignsView />;
    case 'goals':
      return <GoalsView />;
    case 'signals':
      return <SignalsView />;
    case 'ideas':
      return <IdeasView />;
    case 'health':
      return (
        <div className="space-y-6">
          <HealthView />
          <PushToggle />
        </div>
      );
  }
}
