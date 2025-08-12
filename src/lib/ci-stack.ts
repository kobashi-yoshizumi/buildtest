import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as logs from 'aws-cdk-lib/aws-logs';        // ★ 追加

interface CiStackProps extends cdk.StackProps {
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  suffix: string;
}

export class CiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const sourceBucketName = `ci-source-${props.suffix}`;
    const targetBucketName = `readme-deploy-${props.suffix}`;
    const projectName = 'deploy-readme-s3';          // ★ プロジェクト名を変数化

    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      bucketName: sourceBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true
    });

    const targetBucket = new s3.Bucket(this, 'TargetBucket', {
      bucketName: targetBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true
    });

    // CodeBuild service role
    const cbRole = new iam.Role(this, 'CodeBuildServiceRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com')
    });

    cbRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup','logs:CreateLogStream','logs:PutLogEvents'],
      resources: ['*']
    }));
    cbRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject','s3:GetObjectVersion','s3:ListBucket'],
      resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`]
    }));
    cbRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject','s3:ListBucket'],
      resources: [targetBucket.bucketArn, `${targetBucket.bucketArn}/*`]
    }));

    // ★ CodeBuild 用の専用 LogGroup（保持期間はお好みで）
    const cbLogGroup = logs.LogGroup.fromLogGroupName(
      this,
      'DeployReadmeLogGroup',
      `/aws/codebuild/${projectName}`,
    );

    // CodeBuild Project
    const project = new codebuild.Project(this, 'DeployReadmeProject', {
      projectName,
      role: cbRole,
      source: codebuild.Source.s3({
        bucket: sourceBucket,
        path: 'source.zip'
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          TARGET_BUCKET: { value: targetBucket.bucketName }
        }
      },
      // ★ CloudWatch Logs へ明示的に出力
      logging: {
        cloudWatch: {
          enabled: true,
          logGroup: cbLogGroup
        }
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'echo "Deploy README.md to S3"',
              'test -f README.md',
              'aws s3 cp README.md s3://$TARGET_BUCKET/README.md',
              'echo "SUCCESS: README.md deployed"' // ★ 成功行を明示的に出す
            ]
          }
        },
        artifacts: { files: ['README.md'] }
      })
    });

    // ★ コンソールで見やすくするための Metric Filter（アラームは作らない）
    //   ERROR 検出（エラー行を 1 としてカウント）
    new logs.MetricFilter(this, 'CbErrorFilter', {
      logGroup: cbLogGroup,
      metricNamespace: 'Ci/CodeBuild',
      metricName: 'ErrorCount',
      filterPattern: logs.FilterPattern.anyTerm('ERROR','Error','error','FAIL','Failed','Failure'),
      metricValue: '1',
      defaultValue: 0
    });

    //   SUCCESS 検出（成功行を 1 としてカウント）
    new logs.MetricFilter(this, 'CbSuccessFilter', {
      logGroup: cbLogGroup,
      metricNamespace: 'Ci/CodeBuild',
      metricName: 'SuccessCount',
      filterPattern: logs.FilterPattern.anyTerm('SUCCESS','Succeeded','SUCCEEDED','BUILD SUCCESS'),
      metricValue: '1',
      defaultValue: 0
    });

    const oidcProviderArn = `arn:aws:iam::${cdk.Stack.of(this).account}:oidc-provider/token.actions.githubusercontent.com`;

    const ghaRole = new iam.Role(this, 'GithubActionsRole', {
      roleName: `GitHubActionsRole-${props.suffix}`,
      assumedBy: new iam.FederatedPrincipal(
        oidcProviderArn,
        {
          'StringEquals': {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com'
          },
          'StringLike': {
            'token.actions.githubusercontent.com:sub': `repo:${props.githubOwner}/${props.githubRepo}:ref:refs/heads/${props.githubBranch}`
          }
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      description: 'Minimal role for GitHub Actions: upload source.zip and start CodeBuild'
    });

    ghaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject','s3:DeleteObject','s3:ListBucket'],
      resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`]
    }));

    ghaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['codebuild:StartBuild','codebuild:BatchGetBuilds'],
      resources: [project.projectArn]
    }));

    new cdk.CfnOutput(this, 'SourceBucketName', { value: sourceBucket.bucketName });
    new cdk.CfnOutput(this, 'TargetBucketName', { value: targetBucket.bucketName });
    new cdk.CfnOutput(this, 'CodeBuildProjectName', { value: project.projectName });
    new cdk.CfnOutput(this, 'GithubActionsRoleArn', { value: ghaRole.roleArn });
    new cdk.CfnOutput(this, 'CodeBuildLogGroupName', { value: cbLogGroup.logGroupName }); // ★ 追加
  }
}
