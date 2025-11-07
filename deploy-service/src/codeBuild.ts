import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
  type Build, 
} from "@aws-sdk/client-codebuild";
import dotenv from "dotenv";

dotenv.config();

// --- 1. CodeBuild Client Setup ---
const region = process.env.AWS_REGION as string;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID as string;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY as string;

const bucketName = process.env.S3_BUCKET_NAME as string;

if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
  throw new Error(
    "Missing required AWS credentials or S3_BUCKET_NAME for CodeBuild service."
  );
}

const codeBuildClient = new CodeBuildClient({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
});

// Helper function to wait for a bit
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startBuildAndWait = async (deploymentId: string) => {
  console.log(`[CodeBuild] Starting build for ${deploymentId}`);

  // We override the buildspec here so we don't need a buildspec.yml file.
  // This tells CodeBuild exactly what to do.
    const buildSpec = `
version: 0.2
env:
  variables:
    "NODE_OPTIONS": "--openssl-legacy-provider"
    "PUBLIC_URL": "."
phases:
  install:
    commands:
      - npm install --no-fund --no-audit
  build:
    commands:
      - npm run build
artifacts:
  # This tells CodeBuild what to save after the build
  files:
    - '**/*'
  # This is the directory it finds the files in
  base-directory: 'build'
  `;

  // --- 3. Start the Build ---
  const startBuildCommand = new StartBuildCommand({
    projectName: "Vercel-clone-builder", // The project name you created in the AWS console
    
    // --- Source Overrides ---
    sourceTypeOverride: "S3",
    sourceLocationOverride: `${bucketName}/repos/${deploymentId}/`, // <-- THIS IS THE LINE


    // --- Artifact Overrides ---
    artifactsOverride: {
      type: "S3",
      location: bucketName,
      path: `builds/${deploymentId}/`, 
      namespaceType: "NONE",
      name: "/", 
      packaging: "NONE",
    },

    // --- Buildspec Override ---
    buildspecOverride: buildSpec,
  });

  let buildId: string | undefined;

  try {
    const buildData = await codeBuildClient.send(startBuildCommand);
    buildId = buildData.build?.id;

    if (!buildId) {
      throw new Error("Failed to start build or get build ID.");
    }

    console.log(`[CodeBuild] Build started with ID: ${buildId}`);
  } catch (err) {
    console.error(`[CodeBuild] Error starting build:`, err);
    throw err;
  }

  // --- 4. Poll for Build Completion ---
  // Now we must wait for the build to finish.
  let buildSucceeded = false;
  let buildFinished = false;

  while (!buildFinished) {
    await sleep(10000); // Wait 10 seconds between checks
    console.log(`[CodeBuild] Checking status for build ${buildId}...`);

    try {
      const getBuildsCommand = new BatchGetBuildsCommand({
        ids: [buildId],
      });
      const buildsData = await codeBuildClient.send(getBuildsCommand);

      const build = buildsData.builds?.[0] as Build;

      if (!build) {
        throw new Error("Build not found after starting.");
      }

      const status = build.buildStatus;
      console.log(`[CodeBuild] Current status: ${status}`);

      if (status === "SUCCEEDED") {
        buildFinished = true;
        buildSucceeded = true;
      } else if (
        status === "FAILED" ||
        status === "FAULT" ||
        status === "STOPPED" ||
        status === "TIMED_OUT"
      ) {
        buildFinished = true;
        buildSucceeded = false;
      }
    } catch (err) {
      console.error(`[CodeBuild] Error checking build status:`, err);
      
      throw err;
    }
  }

  if (buildSucceeded) {
    console.log(`[CodeBuild] Build ${buildId} SUCCEEDED.`);
  } else {
    console.error(`[CodeBuild] Build ${buildId} FAILED.`);
    throw new Error(`Build ${buildId} failed.`);
  }
};