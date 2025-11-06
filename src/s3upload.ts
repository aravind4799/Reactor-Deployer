import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path, { dirname, join } from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config();


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const bucketName = process.env.S3_BUCKET_NAME;


if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
  throw new Error(
    "Missing required AWS credentials"
  );
}

const s3Client = new S3Client({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
});

const localFilePath = join(__dirname, "../test.txt");
const s3FilePath = "uploads/test.txt";

const fileStream = fs.createReadStream(localFilePath);

fileStream.on("error", (err) => {
  console.log("File Error", err);
});

const uploadParams = {
  Bucket: bucketName,
  Key: s3FilePath,
  Body: fileStream,
};

const runUpload = async () => {
  try {
    const command = new PutObjectCommand(uploadParams);
    const data = await s3Client.send(command);

    console.log("Success! File uploaded:", data);
    const url = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3FilePath}`;
    console.log("File URL:", url);
  } catch (err) {
    console.error("S3 Upload Error:", err);
  }
};

export default runUpload;

