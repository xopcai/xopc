# Skills

A Skill is a reusable set of instructions and optional resources that teaches an Agent how to perform a particular kind of work. Skills shape how work is done; tools provide the actions used to do it.

## Find and enable a Skill

In the Gateway console, open **Skills**, review the description and requirements, then install or enable it for the intended Agent.

In a terminal:

```bash
xopc skills list
xopc skills status <skill-name>
xopc skills install <skill-name>
xopc skills enable <skill-name>
```

Some Skills are already present but need dependencies or configuration before they become ready.

## Configure and verify

```bash
xopc skills config <skill-name>
xopc skills audit <skill-name>
xopc skills test <skill-name>
```

After enabling a Skill, start a new Session with the relevant Agent and make a small request that clearly matches the Skill. The Agent should identify the Skill's workflow and report any missing requirement.

## Trust and security

A Skill can instruct an Agent to use powerful tools or install dependencies. Before enabling a Skill from outside this repository:

1. read its instructions and source;
2. review requested tools, commands, packages, environment variables, and network access;
3. run the security audit;
4. enable it only for Agents that need it;
5. test with non-sensitive input.

Do not assume a popular or signed archive is automatically safe. A Skill's effective access is the combination of its instructions and the Agent's enabled tools.

## Enable, disable, or update

```bash
xopc skills disable <skill-name>
xopc skills status <skill-name>
xopc skills hub --help
```

Disable a Skill when its dependency is unavailable, its instructions are no longer appropriate, or you need to isolate a behavior problem. Disabling preserves its files and configuration.

## When a Skill is not working

| Symptom | Check |
| --- | --- |
| Skill is not listed | Its source directory is available to the current xopc profile |
| Status is not ready | Install required dependencies and complete configuration |
| Agent ignores the Skill | The Skill is enabled for that Agent and the request clearly matches its purpose |
| A command or tool is denied | The Agent policy intentionally allows the required capability |
| Test fails | Read the first failed check and fix that requirement before retrying |

Use `xopc skills status <skill-name>` as the first diagnostic. Avoid editing installed Skill files unless you intend to maintain a custom copy.
