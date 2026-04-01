import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const TEMP_PREFIX = "temp/";

/**
 * Service to handle object storage via Cloudflare R2 (S3 API).
 *
 * Upload flow:
 * 1. Client requests a pre-signed upload URL  → file lands in `temp/{uuid}.ext`
 * 2. On successful entity creation the key is moved to its final path
 *    (e.g. `products/{id}/images/{uuid}.ext`)
 * 3. If creation fails, the `temp/` object is deleted immediately;
 *    any leftovers are cleaned up by the R2 lifecycle rule (24 h TTL).
 */
export class StorageService {
  private static s3Client: S3Client;

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
   * Generate a pre-signed URL for uploading to the **temp/** prefix
   * in the public bucket. Returns the `uploadUrl` (for PUT), the
   */
  public static async getTempUploadUrl(
    folder: string,
    fileName: string,
    contentType: string,
    expiresIn: number = 900
  ) {
    const bucket = process.env.R2_PUBLIC_BUCKET_NAME;
    if (!bucket) throw new Error("R2_PUBLIC_BUCKET_NAME not defined");

    const ext = fileName.includes(".")
      ? fileName.substring(fileName.lastIndexOf("."))
      : "";
    const uuid = crypto.randomUUID();
    const tempKey = `${TEMP_PREFIX}${uuid}${ext}`;
    const finalKey = `${folder}/${uuid}${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: tempKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.getClient(), command, {
      expiresIn,
    });
    const publicUrl = this.getPublicUrl(finalKey);

    return { uploadUrl, tempKey, finalKey, publicUrl };
  }

  /**
   * Move an object from one key to another within the same bucket.
   * Used after successful entity creation to promote temp → permanent.
   */
  public static async moveObject(
    sourceKey: string,
    destinationKey: string,
    bucket?: string
  ): Promise<void> {
    const bucketName = bucket ?? process.env.R2_PUBLIC_BUCKET_NAME;
    if (!bucketName) throw new Error("R2_PUBLIC_BUCKET_NAME not defined");

    const client = this.getClient();

    await client.send(
      new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${sourceKey}`,
        Key: destinationKey,
      })
    );

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: sourceKey,
      })
    );
  }

  /**
   * Delete a single object from a bucket.
   */
  public static async deleteObject(
    key: string,
    bucket?: string
  ): Promise<void> {
    const bucketName = bucket ?? process.env.R2_PUBLIC_BUCKET_NAME;
    if (!bucketName) throw new Error("Bucket name not defined");

    await this.getClient().send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  }

  /**
   * Delete multiple objects from a bucket in one call.
   * Silently ignores keys that don't exist.
   */
  public static async deleteObjects(
    keys: string[],
    bucket?: string
  ): Promise<void> {
    if (keys.length === 0) return;

    const bucketName = bucket ?? process.env.R2_PUBLIC_BUCKET_NAME;
    if (!bucketName) throw new Error("Bucket name not defined");

    await this.getClient().send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
  }

  /**
   * List object keys under a given prefix.
   */
  public static async listObjects(
    prefix: string,
    bucket?: string
  ): Promise<{ key: string; lastModified?: Date | undefined }[]> {
    const bucketName = bucket ?? process.env.R2_PUBLIC_BUCKET_NAME;
    if (!bucketName) throw new Error("Bucket name not defined");

    const response = await this.getClient().send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
      })
    );

    return (response.Contents ?? []).map((obj) => ({
      key: obj.Key ?? "",
      lastModified: obj.LastModified,
    }));
  }

  /**
   * Pre-signed upload URL for the private bucket.
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
   * Pre-signed read URL for a private-bucket object.
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
   * Build the public CDN URL for an asset in the public bucket.
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
