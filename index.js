const core = require('@actions/core');
const io = require("@actions/io");
const { spawn } = require("child_process");
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const choreoApp = process.env.CHOREO_GITOPS_REPO;
    const fileContents = fs.readFileSync(`/home/runner/workspace/${choreoApp}/${process.env.REG_CRED_FILE_NAME}`, 'utf8');
    let data = JSON.parse(fileContents);
    for (const cred of data) {
      if (cred.type == 'ACR') {
        acrPush(cred);
      };
      if (cred.type == 'ECR') {
        ecrPush(cred);
      };
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function ecrPush(cred) {
  let username = cred.credentials.registryUser;
  let password = cred.credentials.registryPassword;
  let region = cred.credentials.region;

  var conifgChild = spawn(`
  aws configure set aws_access_key_id ${username} &&
  aws configure set aws_secret_access_key ${password} &&
  aws configure set default.region ${region} &&
  aws ecr-public get-login-password --region ${region} | docker login --username AWS --password-stdin public.ecr.aws &&
  aws ecr-public describe-repositories --repository-names ${choreoApp} || aws ecr-public create-repository --repository-name ${choreoApp}`,
    {
      shell: true
    });
  conifgChild.stderr.on('data', function (data) {
    console.error("STDERR:", data.toString());
  });
  conifgChild.stdout.on("data", data => {
    console.log(data.toString());
  });
  conifgChild.on('exit', function (exitCode) {
    console.log("Config Child exited with code: " + exitCode);
  });

  const tempImage = process.env.DOCKER_TEMP_IMAGE;
  const newImageTag = `${cred.credentials.registry}/${choreoApp}:${process.env.NEW_SHA}`;
  // Pushing images to ACR
  var child = spawn(`docker image tag ${tempImage} ${newImageTag} && docker push ${newImageTag}`, {
    shell: true
  });
  child.stderr.on('data', function (data) {
    console.error("STDERR:", data.toString());
  });
  child.stdout.on("data", data => {
    console.log(data.toString());
  });
  child.on('exit', function (exitCode) {
    console.log("Child exited with code: " + exitCode);
  });
}

async function acrPush(cred) {
  let username = cred.credentials.registryUser;
  let password = cred.credentials.registryPassword;
  let loginServer = cred.credentials.registry;
  let authenticationToken = Buffer.from(`${username}:${password}`).toString('base64');
  let config;
  const runnerTempDirectory = process.env['RUNNER_TEMP']; // Using process.env until the core libs are updated
  const dirPath = process.env['DOCKER_CONFIG'] || path.join(runnerTempDirectory, `docker_login_${Date.now()}`);
  await io.mkdirP(dirPath);
  const dockerConfigPath = path.join(dirPath, `config.json`);
  if (fs.existsSync(dockerConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(dockerConfigPath, 'utf8'));
      if (!config.auths) {
        config.auths = {};
      }
      config.auths[loginServer] = { auth: authenticationToken };
    }
    catch (err) {
      // if the file is invalid, just overwrite it
      config = undefined;
    }
  }
  if (!config) {
    config = {
      "auths": {
        [loginServer]: {
          auth: authenticationToken
        }
      }
    };
  }
  core.debug(`Writing docker config contents to ${dockerConfigPath}`);
  fs.writeFileSync(dockerConfigPath, JSON.stringify(config));
  core.exportVariable('DOCKER_CONFIG', dirPath);
  console.log('DOCKER_CONFIG environment variable is set');

  const tempImage = process.env.DOCKER_TEMP_IMAGE;
  const newImageTag = `${cred.credentials.registry}/${choreoApp}:${process.env.NEW_SHA}`;
  // Pushing images to ACR
  var child = spawn(`docker image tag ${tempImage} ${newImageTag} && docker push ${newImageTag}`, {
    shell: true
  });
  child.stderr.on('data', function (data) {
    console.error("STDERR:", data.toString());
  });
  child.stdout.on("data", data => {
    console.log(data.toString());
  });
  child.on('exit', function (exitCode) {
    console.log("Child exited with code: " + exitCode);
  });
}

run().catch(core.setFailed);