# PR58 documentation-index correction

The first PR58 integrity job ([run 44034964089, job 133875523481](https://github.com/rafwiewiora/molarium/actions/runs/44034964089/job/133875523481)) rejected the feature-audit README because its narrative had changed while its integrity-index entry retained the previous digest. Inspection also found the same stale entry for the intentionally updated YTHDF2 CPU report. The original failed job remains failed.

The archive preserves both previous reports and their index at main commit `b5b1f9217341f3eb2504c909f8d0f123687852a5`, the exact public CI job/log and a correction receipt. Only those two intended documentation entries are refreshed; every other previously indexed file was verified byte-identical. No molecular input, output, consumed producer, numerical gate or test assertion changed. The full comparison suite is rerun against the corrected index; no scientific measurement is repeated.
