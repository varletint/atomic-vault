import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Service to handle object storage via Cloudflare R2 (S3 API).
 */
export class StorageService {
  private static s3Client: S3Client;

  /**
   * Initialize the S3 client instance.
   */
  public static getClient(): S3Client {
    if (!this.s3Client) {
      const accountId = process.env.R2_ACCOUNT_ID;
      const accessKeyId = process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

      if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error("Missing required Cloudflare R2 environment variables");
      }

      this.s3Client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }

    return this.s3Client;
  }

  /**
   * Get a pre-signed URL to upload a file directly to the public bucket from the browser.
   */
  public static async getPublicUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 900
  ): Promise<string> {
    const bucket = process.env.R2_PUBLIC_BUCKET_NAME;
    if (!bucket) throw new Error("R2_PUBLIC_BUCKET_NAME not defined");

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    return await getSignedUrl(this.getClient(), command, { expiresIn });
  }

  /**
   * Get a pre-signed URL to upload a file directly to the private bucket from the browser.
   */
  public static async getPrivateUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 900
  ): Promise<string> {
    const bucket = process.env.R2_PRIVATE_BUCKET_NAME;
    if (!bucket) throw new Error("R2_PRIVATE_BUCKET_NAME not defined");

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    return await getSignedUrl(this.getClient(), command, { expiresIn });
  }

  /**
   * Get a pre-signed URL to view a file from the private bucket securely.
   */
  public static async getPrivateReadUrl(
    key: string,
    expiresIn: number = 300
  ): Promise<string> {
    const bucket = process.env.R2_PRIVATE_BUCKET_NAME;
    if (!bucket) throw new Error("R2_PRIVATE_BUCKET_NAME not defined");

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await getSignedUrl(this.getClient(), command, { expiresIn });
  }

  /**
   * Generate the public CDN URL for an asset stored in the public bucket.
   * This does not require calling the S3 API, just concatenates the domain and key.
   */
  public static getPublicUrl(key: string): string {
    const domain = process.env.R2_PUBLIC_DOMAIN;
    if (!domain) {
      console.warn(
        "R2_PUBLIC_DOMAIN not defined, public URLs will not work correctly."
      );
      return "";
    }

    const normalizedDomain = domain.endsWith("/")
      ? domain.slice(0, -1)
      : domain;
    const normalizedKey = key.startsWith("/") ? key.substring(1) : key;

    return `${normalizedDomain}/${normalizedKey}`;
  }
}
