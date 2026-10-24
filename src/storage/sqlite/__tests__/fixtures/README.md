# Installed database schema fixtures

`schema-v202.sql` captures an empty real historical schema at v202, current before September 24, 2026. It was generated from commit `a5420983e^`'s v165 baseline using its original migration runner through v202, including the TypeScript conversation UUID and scene-storage cutovers. It excludes SQLite-managed FTS shadow tables and includes the v202 version marker. Generation used an isolated temporary checkout; tests do not need Git history or a network connection.

`schema-v217.sql` is the consolidated v217 baseline from commit `98c42cb86^`, plus its version marker. This represents installations initialized after the October 17 scene cleanup. Such installations have a different retained-table set from installations upgraded from v202, so both paths are tested.

The upgrade tests seed representative conversation, transcript, settings, note, task, knowledge, automation, connector account, and Agent override data, replay the retained SQL to each starting version, and then exercise the production upgrade entry point. The fixture SQL is test data only and is not shipped as a runtime upgrade baseline.
