export const select=rows=>rows.filter(r=>r.status==='open'&&r.priority<=2).sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
