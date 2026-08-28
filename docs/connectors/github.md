# GitHub connector

Connect GitHub when an Agent needs to read repository information or, with explicit permission, create and update GitHub content.

## Connect

1. Open **Connectors** and choose **GitHub**.
2. Sign in and review the requested organization and repository access.
3. Prefer selected repositories instead of all repositories.
4. Start with read-only permissions.
5. Assign the connection to the intended Agent.

## Verify

Ask for a read-only action, for example: “List the five most recently updated open issues in repository X.” Confirm the repository and account before enabling writes.

## Write actions

Creating issues, comments, branches, or pull requests changes shared external state. Configure the Agent to show the proposed action and target before execution. Never grant administrative or secret access for routine repository work.

## Troubleshooting

- Confirm that the authorized account can access the repository.
- Check organization approval and SSO requirements.
- Reconnect after a token or app authorization is revoked.
- Compare GitHub scopes with the action the Agent is attempting.
- Inspect logs without exposing tokens, private URLs, or repository content.
