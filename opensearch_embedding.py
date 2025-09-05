# Lambda trigger: DynamoDB Streams -> this function
# Runtime: python3.11
# Env vars:
#   TABLE_NAME
#   REGION
#   OPENSEARCH_ENDPOINT (e.g., https://abc12345.us-east-1.aoss.amazonaws.com)
#   INDEX_NAME
#   BEDROCK_MODEL_ID (default amazon.titan-embed-text-v2:0)

import os
import json
import boto3
from boto3.dynamodb.types import TypeDeserializer
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from urllib.request import Request, urlopen

TABLE_NAME = os.environ["TABLE_NAME"]
REGION = os.environ.get("REGION", os.environ.get("AWS_REGION", "us-east-1"))
OPENSEARCH_ENDPOINT = os.environ["OPENSEARCH_ENDPOINT"]
INDEX_NAME = os.environ["INDEX_NAME"]
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.titan-embed-text-v2:0")

ddb = boto3.client("dynamodb", region_name=REGION)
bedrock = boto3.client("bedrock-runtime", region_name=REGION)

deser = TypeDeserializer()

def unmarshall(dynamodb_item):
    return {k: deser.deserialize(v) for k, v in dynamodb_item.items()}

def embed(text: str):
    body = {"inputText": text}
    resp = bedrock.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(body),
    )
    payload = json.loads(resp["body"].read().decode("utf-8"))
    vec = (
        payload.get("embedding")
        or (payload.get("embeddings") or [{}])[0].get("embedding")
        or payload.get("vector")
    )
    if not isinstance(vec, list):
        raise RuntimeError("No embedding vector returned from Bedrock")
    return vec

def signed_request(method: str, path: str, body_obj=None):
    """SigV4 signed HTTP request to OpenSearch Serverless (service 'aoss')."""
    url = f"{OPENSEARCH_ENDPOINT}{path}"
    body = json.dumps(body_obj).encode("utf-8") if body_obj is not None else None

    req = AWSRequest(method=method, url=url, data=body, headers={"Content-Type": "application/json"})
    SigV4Auth(boto3.Session().get_credentials(), "aoss", REGION).add_auth(req)
    prepared = req.prepare()

    request = Request(url, data=prepared.body, method=method)
    for k, v in prepared.headers.items():
        request.add_header(k, v)

    with urlopen(request) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")

def update_ddb(pk: str, sk: str, os_id: str):
    ddb.update_item(
        TableName=TABLE_NAME,
        Key={"pk": {"S": pk}, "sk": {"S": sk}},
        UpdateExpression="SET vectorReady = :t, osId = :osid",
        ExpressionAttributeValues={
            ":t": {"BOOL": True},
            ":osid": {"S": os_id},
        },
    )

def handler(event, context):
    for rec in event.get("Records", []):
        if rec.get("eventName") not in ("INSERT", "MODIFY"):
            continue
        new = rec.get("dynamodb", {}).get("NewImage")
        if not new:
            continue

        item = unmarshall(new)

        # Only process CLAUSE items without vectorReady
        if item.get("entity") != "CLAUSE":
            continue
        if item.get("vectorReady") is True:
            continue
        text = item.get("text")
        if not text:
            continue

        doc_id = item.get("docId")
        clause_id = (item.get("sk") or "").replace("CLAUSE#", "") or "unknown"
        os_id = f"{doc_id}::{clause_id}"

        try:
            vector = embed(text)

            os_doc = {
                "id": os_id,
                "docId": doc_id,
                "clauseId": clause_id,
                "source": item.get("source"),
                "fundId": item.get("fundId"),
                "investorId": item.get("investorId"),
                "sectionNumber": item.get("sectionNumber"),
                "normTerm": item.get("normTerm"),
                "text": text,
                "vector": vector,
            }

            path = f"/{INDEX_NAME}/_doc/{os_id}"
            signed_request("PUT", path, os_doc)

            update_ddb(item["pk"], item["sk"], os_id)

        except Exception as e:
            print(f"Error processing {item.get('pk')} {item.get('sk')}: {e}")

    return {"ok": True}
