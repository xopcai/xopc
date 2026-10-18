# Overselling after a warm catalog read
At 10:01 catalog shows tea=4. Reserve 3 succeeds, a subsequent reserve 2 also succeeds, and catalog still shows 4. No concurrent clients in this report. Calls go through reserve -> catalog/cache and store. Preserve synchronous public APIs. Reject invalid quantities and unknown SKUs with no state change. Unrelated cached entries must remain warm.
