import { fetchProjects } from '@/features/projects/api';

export async function allProjectOptions() {
  const items = [];
  for (let offset = 0; ; ) {
    const page = await fetchProjects({ limit: 100, offset, sortBy: 'name', sortOrder: 'asc' });
    items.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return items;
  }
}

