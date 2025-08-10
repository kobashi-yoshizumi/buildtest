import * as cdk from 'aws-cdk-lib';
import { CiStack } from '../lib/ci-stack';

const app = new cdk.App();

new CiStack(app, 'CiReadmeStack', {
  env: { account: '312556765073', region: 'ap-northeast-1' },
  githubOwner: 'kobashi-yoshizumi',
  githubRepo: 'buildtest',
  githubBranch: 'main',
  suffix: 'buildtest-dummy'
});
