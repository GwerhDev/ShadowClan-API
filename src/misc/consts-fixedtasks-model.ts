export type TaskType = 'alltasks' | 'mytasks' | 'clantasks' | 'warbandtasks';

export const tasktype: Record<string, TaskType> = {
  alltasks:     'alltasks',
  mytasks:      'mytasks',
  clantasks:    'clantasks',
  warbandtasks: 'warbandtasks',
} as const;
