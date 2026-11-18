/**
 * Dashboard aggregates.
 *
 * The legacy `search_dashboard_file` screen derived its counts from SQL. The
 * frontend version reads the same collections through the service layer, so
 * the cards stop contradicting the tables they summarise.
 */

import type { DashboardApi } from '../contracts';
import { store } from '../store';
import type { DashboardStats, TimelineEvent } from '../../types';
import { issuesService } from './issues';


export const dashboardService: DashboardApi = {
  async stats(): Promise<DashboardStats> {
    const state = store.getState();
    const openIssues = state.issues.filter((issue) => issue.status !== 'Returned');
    const overdue = await issuesService.overdue();
    const dueToday = openIssues.filter((issue) => {
      const days = Math.ceil((new Date(issue.dueAt).getTime() - Date.now()) / 86_400_000);
      return days <= 0;
    }).length;

    const pages = state.scanPages;
    const approvedPages = pages.filter((page) => page.status === 'Approved').length;

    // Local mode uses only the complete in-memory sample. It must never
    // advertise a historical district volume that was not loaded here.
    const registered = state.files.length;
    const withShelf = state.files.filter((file) => !!file.shelfId).length;

    return {
      totalRecords: registered,
      mappedPercent: Number(((withShelf / registered) * 100).toFixed(1)),
      issuedNow: state.files.filter((file) => file.status === 'Issued').length,
      dueToday,
      // The sample's page rows are not the Department's agreed total page
      // volume, so keep the production digitization percentage unavailable.
      digitizationPercent: 0,
      overdueCount: overdue.length,
      roomCount: state.rooms.length,
      activeBorrowers: (await issuesService.borrowers()).length,
      pendingApprovals: store
        .getState()
        .scanPages.filter((page) => page.status === 'Pending review').length,
      mappedBaselineConfigured: registered > 0,
      digitizationBaselineConfigured: false,
    };
  },

  async activity(limit = 6): Promise<TimelineEvent[]> {
    const toneFor = (kind: string): TimelineEvent['tone'] => {
      if (kind === 'Issue') return 'warning';
      if (kind === 'Return') return 'success';
      if (kind === 'Location change') return 'default';
      return 'default';
    };

    return store
      .getState()
      .movements.slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map((event) => ({
        id: event.id,
        label: event.kind,
        date: event.at.slice(5, 16).replace('T', ' '),
        actor: `${event.kind} · ${event.actor}`,
        detail: `${event.fileBarcode} — ${event.detail}`,
        tone: toneFor(event.kind),
      }));
  },
};
