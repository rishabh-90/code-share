// Lambda trigger: DynamoDB Streams -> this function
// Runtime: nodejs20.x
// Env vars required:
//   TABLE_NAME                (e.g., LegalDocs)
//   REGION                    (e.g., us-east-1)
//   OPENSEARCH_ENDPOINT       (e.g., https://abc12345.us-east-1.aoss.amazonaws.com)
//   INDEX_NAME                (e.g., lpa_clauses)
//   BEDROCK_MODEL_ID          (default: amazon.titan-embed-text-v2:0)

import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";

const {
  TABLE_NAME,
  REGION = process.env.AWS_REGION || "us-east-1",
  OPENSEARCH_ENDPOINT,
  INDEX_NAME,
  BEDROCK_MODEL_ID = "amazon.titan-embed-text-v2:0",
} = process.env;

const ddb = new DynamoDBClient({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });

// ---- SigV4 helper for OpenSearch Serverless ----
async function signedFetch(method, path, bodyObj) {
  const url = new URL(path, OPENSEARCH_ENDPOINT);
  const body = bodyObj ? JSON.stringify(bodyObj) : undefined;

  const signer = new SignatureV4({
    service: "aoss", // OpenSearch Serverless sigv4 service id
    region: REGION,
    sha256: Sha256,
    credentials: undefined, // Lambda role creds resolved automatically
  });

  const signed = await signer.sign({
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: {
      "host": url.hostname,
      "content-type": "application/json",
    },
    body,
  });

  const res = await fetch(url.toString(), {
    method,
    headers: signed.headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenSearch ${method} ${url.pathname} ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

// ---- Bedrock embeddings (Titan v2) ----
async function embed(text) {
  const body = {
    inputText: text,
    // dimensions: 1024, // optional; ensure your index mapping matches model output length
  };
  const cmd = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });
  const resp = await bedrock.send(cmd);
  const payload = JSON.parse(new TextDecoder().decode(resp.body));
  // Robust parsing across versions
  const vec =
    payload.embedding ??
    payload.embeddings?.[0]?.embedding ??
    payload.vector ??
    null;
  if (!Array.isArray(vec)) {
    throw new Error("No embedding vector returned from Bedrock");
  }
  return vec;
}

function toKey(item) {
  return {
    pk: { S: item.pk },
    sk: { S: item.sk },
  };
}

export const handler = async (event) => {
  if (!OPENSEARCH_ENDPOINT || !INDEX_NAME || !TABLE_NAME) {
    throw new Error("Missing required env vars (OPENSEARCH_ENDPOINT, INDEX_NAME, TABLE_NAME)");
  }

  const updates = [];

  for (const r of event.Records ?? []) {
    if (!["INSERT", "MODIFY"].includes(r.eventName)) continue;
    if (!r.dynamodb?.NewImage) continue;

    const item = unmarshall(r.dynamodb.NewImage);

    // Only embed CLAUSE items that aren't processed yet
    if (item.entity !== "CLAUSE") continue;
    if (!item.text || item.vectorReady === true) continue;

    const { docId, source, fundId, investorId, sectionNumber, normTerm } = item;
    const clauseId = item.sk?.replace(/^CLAUSE#/, "") || "unknown";
    const id = `${docId}::${clauseId}`;

    try {
      // 1) Embed
      const vector = await embed(item.text);

      // 2) Upsert to OpenSearch Serverless
      const osDoc = {
        id,
        docId,
        clauseId,
        source,
        fundId,
        investorId: investorId ?? null,
        sectionNumber: sectionNumber ?? null,
        normTerm: normTerm ?? null,
        text: item.text,
        vector, // knn_vector field; mapping must exist with correct dimension
      };
      await signedFetch("PUT", `/${encodeURIComponent(INDEX_NAME)}/_doc/${encodeURIComponent(id)}`, osDoc);

      // 3) Mark vectorReady=true (and set osId) in DDB
      const update = ddb.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: toKey(item),
        UpdateExpression: "SET vectorReady = :t, osId = :osid",
        ExpressionAttributeValues: {
          ":t": { BOOL: true },
          ":osid": { S: id },
        },
      }));
      updates.push(update);
    } catch (err) {
      console.error("Failed to process record", { pk: item.pk, sk: item.sk, err });
      // (optional) you can write to a DLQ or leave item as-is for retry
    }
  }

  if (updates.length) {
    await Promise.allSettled(updates);
  }

  return { ok: true };
};
