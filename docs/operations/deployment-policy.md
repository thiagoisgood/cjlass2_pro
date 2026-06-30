# Deployment Policy

Deployment is controlled by the first line of the commit message.

## Commit message rules

| Commit subject prefix | Decision | Notes |
| --- | --- | --- |
| `[deploy] xxx` | Deploy | Forces deployment from any branch or event. |
| `[skip-deploy] xxx` | Skip | Explicitly skips deployment. |
| `[docs] xxx` | Skip | Documentation-only change, skip deployment. |
| Other commit message on `main` push | Deploy | Default production deployment path. |
| Other commit message outside `main` push | Skip | Build/test may still run, but deploy should not. |

Prefix matching is case-insensitive and only applies at the start of the commit subject.

## Local decision check

```bash
npm run ops:deploy-decision -- --message "[deploy] release finance controls" --branch feature/foo --event push
npm run ops:deploy-decision -- --message "[docs] update runbook" --branch main --event push
npm run ops:deploy-decision -- --message "feat: update app" --branch main --event push
```

For CI shell steps:

```bash
eval "$(npm run --silent ops:deploy-decision -- --format env --message "$COMMIT_MESSAGE" --branch "$BRANCH_NAME" --event "$EVENT_NAME")"
if [ "$DEPLOY_SHOULD_RUN" = "true" ]; then
  echo "Deploying: $DEPLOY_REASON"
else
  echo "Skipping deploy: $DEPLOY_REASON"
fi
```
