import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import dotenv from "dotenv";

dotenv.config();

// --- 1. SQS Client Setup ---
// These are the same credentials and region as your other service
const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const queueUrl = process.env.AWS_SQS_QUEUE_URL;

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

// --- 2. The Infinite Polling Loop ---
const startPolling = async () => {
  // This while(true) loop will run forever
  while (true) {
    try {
      // --- 3. Poll for Messages ---
      // This command attempts to retrieve messages from the queue
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1, // We'll process one message at a time
        WaitTimeSeconds: 20, // This is "Long Polling".
        // It tells SQS to wait up to 20 seconds for a message
        // This is *much* more efficient and cost-effective than
        // polling every millisecond.
      });

      const data = await sqsClient.send(receiveCommand);

      // --- 4. Process Messages (if any) ---
      if (data.Messages && data.Messages.length > 0) {
        const message = data.Messages[0];
        
        console.log("--- NEW MESSAGE RECEIVED ---");
        
        // This is what you asked for: log the raw content
        console.log("Raw Message Body:", message.Body);

        // It's also good practice to parse it
        try {
            const body = JSON.parse(message.Body);
            console.log("Parsed ID:", body.id);
            console.log("Parsed Repo:", body.repoUrl);

            // TODO: In the future, you would do your real work here
            // (e.g., run a build script, update a database, etc.)

        } catch (parseError) {
            console.error("Error parsing message body:", parseError);
        }

        // --- 5. CRITICAL: Delete the Message ---
        // After successfully processing the message, you *must*
        // delete it from the queue. If you don't, it will
        // re-appear after a "visibility timeout" and be
        // processed again (and again, and again...)
        const deleteCommand = new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle, // This is the unique ID for *this* poll
        });
        
        await sqsClient.send(deleteCommand);
        
        console.log("Message processed and deleted.");
        console.log("----------------------------");

      } else {
        // This is not an error, it just means no messages
        // were in the queue during the 20-second poll.
        console.log("No new messages. Re-polling...");
      }

    } catch (err) {
      console.error("Error in polling loop:", err);
      // Wait for 5 seconds before retrying if an error occurs
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Start the loop!
startPolling();

