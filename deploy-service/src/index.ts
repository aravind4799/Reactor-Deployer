import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message, // Import the Message type
} from "@aws-sdk/client-sqs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

import { startBuildAndWait } from "./codeBuild.js";

dotenv.config();

export interface DeploymentMessage {
  id: string;
  repoUrl: string;
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SQS Client Setup
const region = process.env.AWS_REGION as string;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID as string;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY as string;
const queueUrl = process.env.AWS_SQS_QUEUE_URL as string;

if (!region || !accessKeyId || !secretAccessKey || !queueUrl) {
  throw new Error(
    "Missing required AWS credentials or SQS Queue URL. Make sure .env file is correct."
  );
}

const sqsClient = new SQSClient({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
});

console.log("Deployment service started. Polling for messages...");

// --- 2. The Infinite Polling Loop  ---
const startPolling = async () => {
  while (true) {
    try {
      // --- 3. Poll for Messages  ---
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
      });

      const data = await sqsClient.send(receiveCommand);

      // --- 4. Process Messages (if any) ---
      if (data.Messages && data.Messages.length > 0) {
        for (const message of data.Messages as Message[]) {
          if (!message.ReceiptHandle) {
            console.error(
              "Received message with no ReceiptHandle. Cannot delete.",
              message
            );
            continue;
          }

          console.log("--- NEW MESSAGE RECEIVED ---");

          if (message.Body) {
            console.log("Raw Message Body:", message.Body);

            let body: DeploymentMessage | undefined;

            try {

              body = JSON.parse(message.Body) as DeploymentMessage;
              // This service no longer downloads or builds locally.
              // It just tells CodeBuild to do the work.
              console.log(`Triggering AWS CodeBuild project for ${body.id}...`);

              // The CodeBuild project will:
              // 1. Pull source from S3 'repos/{body.id}/'
              // 2. Run the build steps (install, build)
              // 3. Upload artifacts to S3 'builds/{body.id}/'
              await startBuildAndWait(body.id);

              console.log(
                `CodeBuild finished successfully for ${body.id}.`
              );

            } catch (err) {
  
              // If the build fails, we log it but DON'T delete the SQS message.
              // This lets it be retried or moved to a dead-letter queue.
              console.error(`Build failed for ID ${body ? body.id : 'UNKNOWN'}:`, err);
              // We 'continue' to skip the delete command
              continue;
            }
          } else {
            console.log("Received message with no Body.");
          }

          // --- 5. CRITICAL: Delete the Message ---
          // This will only be reached if the try block succeeds
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          });

          await sqsClient.send(deleteCommand);

          console.log("Message processed and deleted.");
          console.log("----------------------------");
        }
      } else {
        console.log("No new messages. Re-polling...");
      }
    } catch (err) {
      console.error("Error in polling loop:", err);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

startPolling();

