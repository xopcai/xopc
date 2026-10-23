# Content-addressed delivery recovery holdout

A new structural family for the usage/tail correction acceptance, separate from E01/E02 and F01/F02. The task aggregates duplicate orders, publishes exact byte hashes, then recovers a missing referenced file and regenerates the manifest. Three repetitions were predeclared; failed attempts are never replaced.

Run only with `run-benchmark-live.mjs --suite xopc-delivery-holdout --seal-grader`. On macOS the isolated Gateway and descendants are denied access to this suite directory in both the frozen checkout and original checkout. Host grading happens after model turns; a real denial probe is required. Other platforms fail closed until an equivalent OS boundary is implemented.

The hidden grader independently checks numeric aggregation, actual delivered bytes, exact manifest fields, extra attachments, report evidence and protected inputs. Calibration accepts reference/equivalent serializations and rejects stale hashes, incomplete/false completion and extra files. This small synthetic family does not establish production generalization. Once opened and diagnosed it becomes regression evidence, not a reusable blind optimizer selection set.
