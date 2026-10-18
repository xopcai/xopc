export const summarize=rows=>({count:rows.filter(r=>r.status==='paid').length,totalCents:rows.filter(r=>r.status==='paid').reduce((n,r)=>n+r.cents,0)});
