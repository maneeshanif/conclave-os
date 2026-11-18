'use client';

import type { ReactNode } from 'react';
import type { PanelState } from '../lib/panels';
import { ActionItems } from './ActionItems';
import { ApprovalsInbox } from './ApprovalsInbox';
import { BoardroomView } from './BoardroomView';
import { BriefView } from './BriefView';
import { CampaignsView } from './CampaignsView';
import { ChannelsView } from './ChannelsView';
import { DeploymentsView } from './DeploymentsView';
import { DepartmentBoard, DepartmentChannel } from './DepartmentPanels';
import { GoalsView } from './GoalsView';
import { HealthView } from './HealthView';
import { IdeasView } from './IdeasView';
import { InboxView } from './InboxView';
import { MeetingsView } from './MeetingsView';
import { NetworkView } from './NetworkView';
import { PipelineView } from './PipelineView';
import { PushToggle } from './PushToggle';
import { SignalsView } from './SignalsView';
import { TalentView } from './TalentView';
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
    case 'boardroom':
      return <BoardroomView />;
    case 'rooms':
      return null; // the list is drawn by the office screen, which owns the world, the drawer and the panels
    case 'deployments':
      return <DeploymentsView />;
    case 'network':
      return <NetworkView />;
    case 'channels':
      return <ChannelsView />;
    case 'meetings':
      return <MeetingsView />;
    case 'talent':
      return <TalentView />;
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
