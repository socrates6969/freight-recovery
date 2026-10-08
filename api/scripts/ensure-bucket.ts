/**
 * `npm run ensure-bucket` (N13): create the dev/test documents bucket if it is missing and enable
 * versioning. Idempotent. Refuses to run with NODE_ENV=production (the AWS bucket is managed by
 * Terraform). Never touches an existing bucket's policy, encryption or lifecycle.
 *
 * Reads only S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_FORCE_PATH_STYLE, S3_ACCESS_KEY_ID and
 * S3_SECRET_ACCESS_KEY (no database or application secrets needed).
 */
import { CreateBucketCommand, HeadBucketCommand, PutBucketVersioningCommand, S3Client } from '@aws-sdk/client-s3';

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;

async function main(): Promise<number> {
  const env = process.env;
  if ((env['NODE_ENV'] ?? 'production') === 'production') {
    process.stderr.write('ensure-bucket: refused (NODE_ENV is production or unset; the AWS bucket is managed by Terraform)\n');
    return 1;
  }
  const bucket = env['S3_BUCKET'] ?? 'fr-documents-dev';
  if (!BUCKET_RE.test(bucket)) {
    process.stderr.write('ensure-bucket: S3_BUCKET is not a valid bucket name\n');
    return 1;
  }
  const endpoint = env['S3_ENDPOINT'];
  const accessKeyId = env['S3_ACCESS_KEY_ID'];
  const secretAccessKey = env['S3_SECRET_ACCESS_KEY'];
  const client = new S3Client({
    region: env['S3_REGION'] ?? 'us-east-1',
    forcePathStyle: (env['S3_FORCE_PATH_STYLE'] ?? '').toLowerCase() === 'true',
    ...(endpoint ? { endpoint } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  try {
    let exists = true;
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404) throw e;
      exists = false;
    }
    if (!exists) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      process.stdout.write(`ensure-bucket: created ${bucket}\n`);
    } else {
      process.stdout.write(`ensure-bucket: ${bucket} exists\n`);
    }
    await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    process.stdout.write('ensure-bucket: versioning enabled\n');
    return 0;
  } catch (e) {
    process.stderr.write(`ensure-bucket: failed (${(e as Error).name})\n`);
    return 1;
  } finally {
    client.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  () => process.exit(1),
);
