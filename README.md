# CDK CI README Sample

test2

This stack creates:
- S3 (source): ci-source-buildtest-dummy
- S3 (target): readme-deploy-buildtest-dummy
- CodeBuild project: deploy-readme-s3
- IAM Role for GitHub Actions (OIDC): GitHubActionsRole-buildtest-dummy

GitHub: kobashi-yoshizumi/buildtest (branch: main)

## Quickstart
```bash
npm install
npm run build
npm run bootstrap
npm run deploy
```

If your account doesn't have the GitHub OIDC provider yet:
```bash
aws iam create-open-id-connect-provider     --url https://token.actions.githubusercontent.com     --client-id-list sts.amazonaws.com     --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```
