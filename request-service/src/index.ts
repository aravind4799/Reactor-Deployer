

import express, { type Request , type Response } from "express";
import {
  S3Client,
  GetObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { Readable } from "stream"; // For typing the stream

dotenv.config();

const region = process.env.AWS_REGION as string;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID as string;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY as string;
const bucketName = process.env.S3_BUCKET_NAME as string;

if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
  throw new Error(
    "Missing required AWS credentials or Bucket Name for S3. Make sure .env file is correct."
  );
}

const s3Client = new S3Client({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
}); 

const app = express(); 

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;



// --- 2. The Main Request Handler ---
// We use `app.use` to catch all paths and methods,
// then filter for GET requests inside.
app.use(async (req: Request, res: Response) => {

  // Only process GET requests
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    // --- 3. Extract ID from subdomain ---
    // 'req.hostname' would be 'id.my-vercel-ara.com'
    const host = req.hostname;
    const parts = host.split(".");
    if (parts.length < 3) {
      return res
        .status(400)
        .send("Invalid hostname. Expected format: {id}.my-vercel-ara.com");
    }
    const id = parts[0];

    // --- 4. Determine File Path ---
    // 'req.path' is the part after the domain (e.g., "/", "/index.html", "/css/style.css")
    let filePath = req.path;
    if (filePath === "/") {
      filePath = "index.html"; // Serve index.html by default
    }

    // Remove leading slash for S3 key
    if (filePath.startsWith("/")) {
      filePath = filePath.substring(1);
    }

    // --- 5. Construct S3 Key ---
    // This points to the *build output* folder
    const s3Key = `builds/${id}/${filePath}`;
    console.log(`Attempting to fetch from S3: ${s3Key}`);

    // --- 6. Get Object from S3 ---
    const getObjectParams = {
      Bucket: bucketName,
      Key: s3Key,
    };

    let s3Object: GetObjectCommandOutput;
    try {
      s3Object = await s3Client.send(new GetObjectCommand(getObjectParams));
    } catch (s3Error: any) {
      if (s3Error.name === "NoSuchKey") {
        console.warn(`File not found in S3: ${s3Key}`);
        return res.status(404).send("File not found.");
      }
      // Handle other S3 errors
      throw s3Error;
    }

    // --- 7. Set Content-Type ---
    // Use the ContentType from S3, or guess if it's missing
    const contentType = s3Object.ContentType || guessContentType(filePath);
    res.set("Content-Type", contentType);

    // --- 8. Stream the File to the User ---
    if (s3Object.Body && s3Object.Body instanceof Readable) {
      s3Object.Body.pipe(res);
    } else {
      throw new Error(`S3 object body is not a readable stream for ${s3Key}`);
    }
  } catch (error: any) {
    console.error(`Error in request handler:`, error);
    res.status(500).send("Internal server error.");
  }
});

// --- 9. Helper Function to Guess Content-Type ---
// S3 is usually good at this, but this is a fallback.
const guessContentType = (filePath: string): string => {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg")) return "image/jpeg";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream"; // Default binary type
};
// Add "0.0.0.0" to app.listen.
// This tells the server (running in WSL) to accept connections
app.listen(port, "0.0.0.0", () => {
  console.log(`Request handler service running on port ${port}`);
  console.log(
    `Listening for requests to subdomains (e.g., {id}.my-vercel-ara.com:${port})`
  );
});

