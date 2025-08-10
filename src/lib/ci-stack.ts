import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';

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

    const project = new codebuild.Project(this, 'DeployReadmeProject', {
      projectName: 'deploy-readme-s3',
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
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'echo "Deploy README.md to S3"',
              'test -f README.md',
              'aws s3 cp README.md s3://$TARGET_BUCKET/README.md'
            ]
          }
        },
        artifacts: { files: ['README.md'] }
      })
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
  }
}
