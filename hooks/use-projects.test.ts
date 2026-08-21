import { describe, expect, it } from 'vitest';
import type { Area, Project } from '@/lib/db/types';
import { groupByArea } from './use-projects';

/**
 * The grouping, as a pure function.
 *
 * Tested here rather than through the screen because the two behaviours worth
 * holding are both invisible in a happy path: an empty area still gets a group,
 * and a project pointing at an area this device has not pulled yet has to land
 * somewhere rather than disappearing.
 */

function area(id: string, name: string): Area {
  return {
    id,
    userId: 'local',
    name,
    sortKey: id,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    deletedAt: null,
    rowVersion: 1,
    _del: 0,
  };
}

function project(id: string, areaId: string): Project {
  return {
    id,
    userId: 'local',
    areaId,
    name: id,
    notes: '',
    status: 'active',
    color: '#BD6D5C',
    dueDate: null,
    completedAt: null,
    sortKey: id,
    archivedAt: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    deletedAt: null,
    rowVersion: 1,
    _del: 0,
    _archived: 0,
  };
}

describe('grouping projects under their area', () => {
  it('puts each project under its own area', () => {
    const groups = groupByArea(
      [area('a1', 'Home'), area('a2', 'Work')],
      [project('p1', 'a1'), project('p2', 'a2'), project('p3', 'a1')],
    );

    expect(groups.map((g) => g.area?.name)).toEqual(['Home', 'Work']);
    expect(groups[0]!.projects.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(groups[1]!.projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('keeps an empty area on the screen', () => {
    // A folder that vanishes when you empty it is a folder you cannot put
    // anything back into.
    const groups = groupByArea([area('a1', 'Home')], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.projects).toEqual([]);
  });

  it('puts unfiled projects last', () => {
    // The opposite of the board, where Inbox comes first. A project with no area
    // is filed badly, not filed urgently, and the areas somebody built are what
    // they opened the screen to look at.
    const groups = groupByArea([area('a1', 'Home')], [project('p1', ''), project('p2', 'a1')]);
    expect(groups.map((g) => g.area?.name ?? null)).toEqual(['Home', null]);
    expect(groups[1]!.projects.map((p) => p.id)).toEqual(['p1']);
  });

  it('leaves out the unfiled group when there is nothing in it', () => {
    const groups = groupByArea([area('a1', 'Home')], [project('p1', 'a1')]);
    expect(groups).toHaveLength(1);
  });

  it('catches a project pointing at an area this device has not pulled', () => {
    // Areas and projects arrive in one pull page, applied parents-first, but a
    // page boundary can still split them. Dropping the project off the screen
    // until sync catches up would look like data loss.
    const groups = groupByArea([], [project('p1', 'a-not-here')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.area).toBeNull();
    expect(groups[0]!.projects.map((p) => p.id)).toEqual(['p1']);
  });

  it('returns nothing at all for an empty store', () => {
    expect(groupByArea([], [])).toEqual([]);
  });
});
